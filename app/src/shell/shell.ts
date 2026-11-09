import type { Session } from "../session/types";
import type { TeacherUnitsSurfaceSeam } from "../teacherUnits/unitsController";
import type { MyUnitsOpenUnitIntent } from "./surfaces/myUnits";
import type { ListClasses } from "../classes/listClasses";
import type {
  UpdateTeacherClassOrder,
  ReadTeacherClassColors,
} from "../classes/classOrder";
import type { UpdateClassMetadata } from "../classes/updateClassMetadata";
import type { UpdateClassColor } from "../classes/updateClassColor";
import type { CreateClass } from "../classes/createClass";
import type { ActivateClass } from "../classes/activateClass";
import type { SyncRoster } from "../classes/syncRoster";
import type { LoadClassRosterAccessor } from "../classes/classRoster";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
} from "../assignments/detail/attempts-wire";
import type { AssessmentStudentAssignmentsForClassCallable } from "../assignments/detail/studentAssignments-wire";
import type { ImportFromClassroomDeps } from "../classes/importFromClassroom";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
  RefreshRoster,
} from "../settings/integrations/types";
import { renderHeader } from "./header";
import { renderNavigation, type WorkspaceSurfaceKey } from "./navigation";
import { renderFooter } from "./footer";
import {
  type ClassWorkspaceSection,
  type CurriculumHistoryController,
  type SettingsHistoryController,
  type ShellHistoryState,
  type UnitsHistoryController,
  parseShellHistoryState,
  parseShellHash,
  hashForState,
  urlWithHash,
} from "./navigationHistory";
import { dismissOpenModals } from "./openModals";
import { mountWorkspaceOutlet } from "./surfaces/workspace";
import { teacherUnitsSurfaceEnabled } from "./surfaces/teacherUnitsPanel";
import { readStudentSupportSeam } from "../supportAccess/session";
import { isSupportOnlyTeacher } from "./supportWorkspace";
import type { ClassSummary } from "../classes/types";
import type { SharedStudent } from "../supportAccess/types";
import type { SnapshotPreview } from "./surfaces/snapshot";
import type {
  ClassManagementIntent,
  ClassWorkspaceReturn,
  ClassesStudentIntent,
  StudentDetailHistorySeam,
} from "./surfaces/classes";

type ClassesHistoryNotify = Parameters<StudentDetailHistorySeam["notify"]>[0];
import type {
  CurriculumAssignmentDetailSeam,
  LessonResultsIntent,
} from "./surfaces/curriculum";
import type { AssignmentSummaryCallable } from "../assignments/summary/types";
import type { LessonResultsCallable } from "../assignments/summary/lessonResults";
import type {
  AccommodationsListStudentsCallable,
  AccommodationsGetCallable,
  AccommodationsSetCallable,
} from "../accommodations/wire";

// Top-level teacher-workspace shell mount.
//
// Consumes the immutable activeTeacher Session Object and renders the
// header, persistent left-side navigation, workspace outlet, and
// footer. The shell is a pure DOM builder: it opens no Firestore
// listeners, invokes no callables, and reads only fields already
// present on the Session or data retrieved through injected fetchers
// wired at the client entry point.
//
// Sprint 6C replaces the Sprint 6A/6B top-nav with the persistent
// left-side navigation defined in TEACHER_EXPERIENCE_PHILOSOPHY.md
// §3.3. Sprint 28.6D makes Classes the default landing surface (the
// operational home) as the teacher information-architecture transition;
// see SPRINT_28_6_ARCHITECTURAL_BLUEPRINT.md §4. A direct/deep-link
// entry that targets a specific surface or Assignment Detail is still
// honored - the shell only chooses Classes as the initial surface for a
// normal workspace entry with no more specific destination.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type ShellDeps = {
  readonly onSignOut: () => void;
  readonly listClasses: ListClasses;
  // Sprint 6G: injected same-tab launch handler. The real
  // implementation is wired at the entry point; tests pass a spy.
  readonly onLaunchPresentMode: () => void;
  // Sprint 7B: optional static Snapshot preview payload. Defaults to
  // null (no preview) so production renders the certified no-data
  // state. Tests inject the fictional preview to validate hierarchy.
  readonly snapshotPreview?: SnapshotPreview | null;
  // Sprint 8C: Teacher Integrations dependencies. Null in unit tests
  // that do not exercise Settings > Integrations; the real entry point
  // wires the callable seam. See LMS_EXPERIENCE.md §3 and PDR-020c.
  readonly integrations?: IntegrationsDeps | null;
  // Sprint 8D.1: authoritative assignment lifecycle callables consumed
  // by the Assign Experience.
  readonly assignments?: AssignmentsCallables | null;
  // Sprint 30A.1 UX correction: canonical teacher class-order writer,
  // consumed by the Assign dialog's reorder control. Null in tests that
  // do not exercise reordering.
  readonly updateClassOrder?: UpdateTeacherClassOrder | null;
  // Sprint 30A.1 Class Settings V1, consumed by the Classes workspace's
  // Class Settings modal. Null in tests that do not exercise it.
  readonly updateClassMetadata?: UpdateClassMetadata | null;
  readonly updateClassColor?: UpdateClassColor | null;
  readonly readClassColors?: ReadTeacherClassColors | null;
  // Sprint 13B remediation: entry-point seam that lets the Curriculum
  // surface register published assignment metadata and open the
  // certified Assignment Detail surface.
  readonly assignmentDetail?: CurriculumAssignmentDetailSeam | null;
  // Sprint 15: certified summary callable consumed by the Active
  // Assignments dashboard for per-card progress counts.
  readonly assignmentSummary?: AssignmentSummaryCallable | null;
  // Sprint 28.6E: certified lesson-level summary callable consumed by the
  // Curriculum lesson-card View Summary surface.
  readonly lessonSummary?: LessonResultsCallable | null;
  // U2.2 My Units seam; null unless the entry-point gate is open.
  readonly teacherUnits?: TeacherUnitsSurfaceSeam | null;
  // Teacher Units UX Milestone 1A: the destination a fresh page load asked
  // for (its URL hash, captured once by the entry point and parsed with
  // `parseShellHash`). A request only: it is validated below, and anything
  // unavailable falls back without rendering the requested surface first.
  readonly initialState?: ShellHistoryState | null;
  // Sprint 20 internal beta: injected create-class callable seam.
  readonly createClass?: CreateClass | null;
  // Sprint 24B Phase 2: injected dependencies for the primary Import
  // Class from Google Classroom flow.
  readonly importFromClassroom?: ImportFromClassroomDeps | null;
  // Sprint 24B Phase 2B.4: certified `classesActivate` seam.
  readonly activateClass?: ActivateClass | null;
  // Sprint 24B Phase 2B.8: certified `lmsClassesSyncRoster` seam
  // consumed by the LMS class workspace for the automatic initial sync
  // after activation and for the manual "Sync roster" affordance.
  readonly syncRoster?: SyncRoster | null;
  // Teacher-controlled Google Classroom roster refresh (Class settings);
  // never called on class open.
  readonly refreshRoster?: RefreshRoster | null;
  // Sprint 29G.5P: teacher Students-tab roster reader seam.
  readonly loadRoster?: LoadClassRosterAccessor | null;
  // Student Detail V1: lazy accessor for assessmentAttemptsListForClass.
  readonly loadAttempts?: (() => AttemptsListForClassCallable | null) | null;
  // Student Progress & Assignment Membership Phase A, Slice 4: lazy
  // accessor for assessmentStudentAssignmentsForClass.
  readonly loadExpectedAssignments?:
    | (() => AssessmentStudentAssignmentsForClassCallable | null)
    | null;
  // Sprint 30 Show Your Thinking: lazy accessor for assessmentAttemptGetForTeacher.
  readonly loadAttemptDetail?: (() => AttemptGetForTeacherCallable | null) | null;
  // Slice 7: Student Services accommodation seams (G19-gated; optional).
  readonly listStudents?: AccommodationsListStudentsCallable | null;
  readonly getAccommodation?: AccommodationsGetCallable | null;
  readonly setAccommodation?: AccommodationsSetCallable | null;
};

// Browser Back/Forward support: at most one popstate listener may be
// active at a time. `mountTeacherShell` can run again later in the same
// page life (a session `rerun`, e.g. sign-out/sign-in), which rebuilds
// the whole shell from scratch; without this module-scope guard, each
// remount would stack another `window` listener closing over a
// torn-down shell instance (a leak, and a source of stale restores).
let activeShellPopstateCleanup: (() => void) | null = null;

type ClassesDetailHistoryController = Parameters<StudentDetailHistorySeam["registerController"]>[0];

export function mountTeacherShell(
  session: ActiveTeacher,
  mount: HTMLElement,
  deps: ShellDeps,
): void {
  const doc = mount.ownerDocument;
  // Browser Back/Forward support: derived from the connected document
  // rather than injected, so the shell needs no new dependency and tests
  // get real, controllable `pushState`/`replaceState`/`popstate` behavior
  // from jsdom for free. Absent (no `defaultView`) disables all history
  // integration; every other behavior in this function is unaffected.
  const win = doc.defaultView;

  renderHeader(mount, session, { onSignOut: deps.onSignOut });

  const body = doc.createElement("div");
  body.className = "shell-body";
  body.setAttribute("data-testid", "shell-body");

  // Startup uses the destination captured by the entry point before router
  // dispatch. A later session rerun must not pick up ambient history state.
  let activeKey: WorkspaceSurfaceKey = "classes";
  // Sprint 28.5D (D2A): true while an overlay surface (Assignment Detail)
  // occupies the outlet in place of the active workspace surface. The active
  // navigation context (Classes by default) remains the active surface
  // throughout, but a nav click on the already-active item must still
  // re-mount that surface to leave the overlay, so the normal same-key
  // early-return is suspended while this is set. This is a single bounded
  // flag, not a navigation state machine.
  let showingDetail = false;
  const navMount = doc.createElement("div");
  navMount.className = "shell-nav-mount";
  body.appendChild(navMount);
  const outletHost = doc.createElement("div");
  outletHost.className = "shell-outlet-host";
  body.appendChild(outletHost);

  // Sprint 28.6F: shell-owned, ephemeral class-management intent. Settings'
  // "Classes & Google Classroom" section and the Classes `+ Add a class`
  // entry point invoke the SAME workflow (which lives on the Classes
  // surface). When the teacher chooses Import / Create from Settings, the
  // opener records the intent here and navigates to Classes; the next
  // Classes mount consumes it once and opens the matching control (the
  // create form, or focus on the import entry point). A single one-shot,
  // not a router: any later Classes visit shows the plain list. Living on
  // the shell instance means it cannot leak across sessions or tests.
  let classManagementIntent: ClassManagementIntent | null = null;

  // Browser Back/Forward support: the Classes surface's restore
  // capability for its own nested Student Detail state (see
  // StudentDetailHistorySeam in classes.ts), re-registered synchronously
  // every time Classes mounts and explicitly cleared whenever the shell
  // navigates away from Classes so a stale reference into a torn-down
  // render tree is never invoked.
  let classesDetailController: ClassesDetailHistoryController | null = null;
  // Browser Back/Forward support: which class's Students (roster) tab is
  // currently the open history checkpoint, if any - set on
  // "enter-workspace", cleared on "exit-workspace" and whenever the shell
  // navigates away from Classes. Lets an "exit-detail" notify (Back to
  // Students / Detail closing) replace the CURRENT entry with the correct
  // one-level-up `shell-classes-workspace` state without classes.ts having
  // to hand its internal state shape across the seam.
  let currentWorkspaceClassId: string | null = null;
  // Browser Back/Forward: restore capabilities for Curriculum's and
  // Settings' own nested pages, registered by each surface on mount and
  // cleared whenever the shell navigates away from it (same lifetime rule as
  // `classesDetailController`).
  let curriculumController: CurriculumHistoryController | null = null;
  let settingsController: SettingsHistoryController | null = null;
  // Teacher Units UX Milestone 1: My Units is a top-level surface only when
  // the shell holds an enabled Teacher Units seam (never in a closed
  // release). Otherwise "units" is refused as a destination everywhere.
  const unitsEnabled = teacherUnitsSurfaceEnabled(deps.teacherUnits ?? null);
  let unitsController: UnitsHistoryController | null = null;
  // One-shot: the next My Units mount opens on its archived view (Settings >
  // Units, or a restored archived-view history entry).
  let archivedUnitsIntent = false;
  // Milestone 2A one-shot: the next My Units mount opens on this unit
  // (Curriculum's "View unit" after Add to Unit).
  let openUnitIntent: MyUnitsOpenUnitIntent | null = null;
  // One-shot: the next Curriculum mount opens this lesson's Results.
  let lessonResultsIntent: LessonResultsIntent | null = null;
  // Student Support Workspace (V2 P3, supportWorkspace.ts): true once this
  // shell has proven the teacher owns zero classes and has shared students.
  // Never persisted; a fresh shell always starts false. While true, Classes
  // and preview-only Curriculum are the destinations. Navigation, intra-shell
  // seams and Back/Forward refuse teaching-only surfaces.
  let supportOnly = false;
  // True while a fresh direct link to a teaching-only surface waits for the
  // support-only condition to resolve (see `mountInitial` below).
  let resolvingWorkspace = false;
  // undefined means no traversal; null means the browser selected a legacy entry.
  let pendingStartupDestination: ShellHistoryState | null | undefined;
  let restoreHistoryDestination: ((state: ShellHistoryState | null, fromStartup?: boolean) => void) | undefined;
  // True while Classes shows the unresolved workspace (see
  // SupportWorkspaceSeam.setUnresolved): no navigation, Classes only.
  let workspaceUnresolved = false;
  // One-shot results of the shell's own resolution reads, consumed by the
  // first surface read that would otherwise repeat them.
  let primedClasses: Promise<ReadonlyArray<ClassSummary>> | null = null;
  let primedShared: Promise<ReadonlyArray<SharedStudent>> | null = null;

  // Browser Back/Forward: the single push/replace path for every history
  // state, so each entry's URL is derived by the one mapping in
  // navigationHistory.ts (`hashForState`). No-ops without a window.
  // Each Summary that opens students owns its own trail. If it is replaced,
  // the earliest student entry is the safe slot for the fallback Summary.
  const assignmentReturns = new Map<string, "summary" | "first-student">();
  type AssignmentDestination = Extract<ShellHistoryState, { kind: "shell-assignment-detail" }> &
    { readonly returnKey: string };
  let returningToAssignment: {
    readonly fallback?: AssignmentDestination;
    readonly restoredOrigin?: { readonly classId: string; readonly assignmentId: string };
  } | null = null;
  // Invalidate the previous destination before handing off to its successor.
  // The Classes controller owns pending reads for its mount.
  const cancelNavigationRestore = (): void => {
    returningToAssignment = null;
    classesDetailController?.cancelPendingRestore();
  };
  const currentHistoryState = (): ShellHistoryState | null => parseShellHistoryState(win?.history.state);
  const summaryUrl = (classId: string, assignmentId: string): string => {
    const hash = hashForState({ kind: "shell-assignment-detail", surface: "classes", classId, assignmentId });
    return win === null ? "" : new URL(urlWithHash(win.location.pathname, hash), win.location.href).href;
  };
  const priorEntriesMatchSummary = (classId: string, assignmentId: string, steps: number): boolean => {
    if (win === null) return false;
    // The classic History API cannot inspect a preceding entry. Use the
    // browser's same-document entry list when available; a URL is only
    // evidence of the destination, not of access to the assignment.
    const navigation = (win as Window & {
      readonly navigation?: {
        readonly currentEntry: Pick<NavigationHistoryEntry, "index"> | null;
        readonly entries: () => ReadonlyArray<Pick<NavigationHistoryEntry, "url" | "sameDocument">>;
      };
    }).navigation;
    const index = navigation?.currentEntry?.index ?? -1;
    if (navigation === undefined || index < steps) return false;
    const entries = navigation.entries();
    const summary = entries[index - steps];
    if (summary?.sameDocument !== true || summary.url !== summaryUrl(classId, assignmentId)) return false;
    return entries.slice(index - steps + 1, index).every((entry) => {
      if (!entry.sameDocument || entry.url === null) return false;
      const route = parseShellHash(new URL(entry.url).hash);
      return route?.kind === "shell-student-detail" && route.classId === classId &&
        route.originAssignmentId === assignmentId;
    });
  };
  const pushShellState = (state: ShellHistoryState): void => {
    returningToAssignment = null;
    win?.history.pushState(state, "", urlWithHash(win.location.pathname, hashForState(state)));
  };
  const replaceShellState = (state: ShellHistoryState): void => {
    const previous = currentHistoryState();
    if (previous?.kind === "shell-assignment-detail" && previous.returnKey !== undefined &&
        assignmentReturns.has(previous.returnKey)) {
      assignmentReturns.set(previous.returnKey, "first-student");
    }
    win?.history.replaceState(state, "", urlWithHash(win.location.pathname, hashForState(state)));
  };

  const workspaceDeps = {
    listClasses: (uid: string): Promise<ReadonlyArray<ClassSummary>> => {
      const primed = primedClasses;
      primedClasses = null;
      return primed ?? deps.listClasses(uid);
    },
    onLaunchPresentMode: deps.onLaunchPresentMode,
    snapshotPreview: deps.snapshotPreview ?? null,
    integrations: deps.integrations ?? null,
    assignments: deps.assignments ?? null,
    updateClassOrder: deps.updateClassOrder ?? null,
    updateClassMetadata: deps.updateClassMetadata ?? null,
    updateClassColor: deps.updateClassColor ?? null,
    readClassColors: deps.readClassColors ?? null,
    assignmentDetail: deps.assignmentDetail ?? null,
    assignmentSummary: deps.assignmentSummary ?? null,
    lessonSummary: deps.lessonSummary ?? null,
    teacherUnits: deps.teacherUnits ?? null,
    createClass: deps.createClass ?? null,
    importFromClassroom: deps.importFromClassroom ?? null,
    activateClass: deps.activateClass ?? null,
    syncRoster: deps.syncRoster ?? null,
    refreshRoster: deps.refreshRoster ?? null,
    loadRoster: deps.loadRoster ?? null,
    loadAttempts: deps.loadAttempts ?? null,
    loadExpectedAssignments: deps.loadExpectedAssignments ?? null,
    loadAttemptDetail: deps.loadAttemptDetail ?? null,
    listStudents: deps.listStudents ?? null,
    getAccommodation: deps.getAccommodation ?? null,
    setAccommodation: deps.setAccommodation ?? null,
    // Sprint 28.6C: bounded intra-shell navigation seam. A workspace surface
    // (Classes) uses it to request a surface switch - e.g. the empty
    // Assignments state routing to Curriculum, and the Assignment Detail
    // return routing back to Classes. It performs exactly the same transition
    // as clicking the corresponding nav item.
    navigateToSurface: (next: WorkspaceSurfaceKey): void => {
      navigateTo(next);
    },
    // Browser Back/Forward support: bundles the notify/registerController
    // pair Classes uses to keep browser history in sync with its own
    // Student Detail open/closed transitions (see StudentDetailHistorySeam
    // in classes.ts). `null` when there is no connected window (disables
    // history integration entirely; Student Detail behaves exactly as
    // before this feature).
    studentDetailHistory: win
      ? {
          notify: (input: ClassesHistoryNotify): void => {
            if (input.kind === "enter-workspace") {
              currentWorkspaceClassId = input.classId;
              pushShellState({
                kind: "shell-classes-workspace",
                surface: "classes",
                classId: input.classId,
                section: input.section,
              });
            } else if (input.kind === "exit-workspace") {
              currentWorkspaceClassId = null;
              replaceShellState({ kind: "shell-surface", surface: "classes" });
            } else if (input.kind === "enter-detail") {
              const previous = currentHistoryState();
              const back = previous?.kind === "shell-student-detail" &&
                previous.classId === input.classId &&
                previous.originAssignmentId === input.originAssignmentId
                ? previous.assignmentReturn : undefined;
              pushShellState({
                kind: "shell-student-detail",
                surface: "classes",
                classId: input.classId,
                studentId: input.studentId,
                ...(input.originAssignmentId !== undefined ? { originAssignmentId: input.originAssignmentId } : {}),
                ...(back !== undefined ? { assignmentReturn: { key: back.key, steps: back.steps + 1 } } : {}),
              });
            } else if (input.kind === "exit-detail") {
              // exit-detail: one level up from Student Detail is the
              // Students (roster) section of the same class, never the flat
              // Classes list - see StudentDetailHistorySeam.
              // `currentWorkspaceClassId` reflects whichever class is
              // actually open (set by the matching "enter-workspace").
              const classId = currentWorkspaceClassId;
              if (classId === null) return;
              replaceShellState({
                kind: "shell-classes-workspace",
                surface: "classes",
                classId,
                section: "roster",
              });
            } else if (input.kind === "enter-assignment-detail") {
              pushShellState({
                kind: "shell-assignment-detail",
                surface: "classes",
                classId: input.classId,
                assignmentId: input.assignmentId,
              });
            } else if (input.kind === "switch-to-class-assignments") {
              // Assignment Detail class switcher fallback: leave the Summary
              // overlay and hand the target class to the fresh Classes mount.
              // Push an entry so Back returns to the Summary the teacher left.
              navigateTo("classes", {
                fromPopstate: true,
                workspaceReturn: { classId: input.classId, tab: "assignments" },
              });
              currentWorkspaceClassId = input.classId;
              pushShellState({
                kind: "shell-classes-workspace",
                surface: "classes",
                classId: input.classId,
                section: "assignments",
              });
            } else {
              // Back to class hands its workspace to the fresh Classes mount
              // and replaces the Summary entry with the class's Assignments.
              const previous = currentHistoryState();
              // A recovered Summary occupies the first student slot. Keep
              // its key on this replacement so surviving students can recover it again.
              const returnKey = previous?.kind === "shell-assignment-detail" &&
                previous.classId === input.classId && previous.returnKey !== undefined &&
                assignmentReturns.get(previous.returnKey) === "first-student"
                ? previous.returnKey : undefined;
              navigateTo("classes", {
                fromPopstate: true,
                workspaceReturn: { classId: input.classId, tab: "assignments" },
              });
              currentWorkspaceClassId = input.classId;
              replaceShellState({
                kind: "shell-classes-workspace",
                surface: "classes",
                classId: input.classId,
                section: "assignments",
                ...(returnKey !== undefined ? { returnKey } : {}),
              });
            }
          },
          returnToAssignment: (classId: string, assignmentId: string): boolean => {
            if (returningToAssignment !== null) return true;
            const current = currentHistoryState();
            const back = current?.kind === "shell-student-detail" &&
              current.classId === classId && current.originAssignmentId === assignmentId
              ? current.assignmentReturn : undefined;
            const target = back === undefined ? undefined : assignmentReturns.get(back.key);
            if (target === undefined && back !== undefined && priorEntriesMatchSummary(classId, assignmentId, back.steps)) {
              // Restored Student Detail already checked the assignment and
              // roster. Reuse that check for the matching Summary restore.
              returningToAssignment = { restoredOrigin: { classId, assignmentId } };
              win.history.go(-back.steps);
              return true;
            }
            if (back === undefined || target === undefined || back.steps >= win.history.length) {
              // The trail cannot be verified. Keep the authorized class fallback.
              replaceShellState({ kind: "shell-classes-workspace", surface: "classes", classId, section: "assignments" });
              classesDetailController?.restoreWorkspace(classId, "assignments");
              return true;
            }
            const summary: AssignmentDestination = {
              kind: "shell-assignment-detail", surface: "classes", classId, assignmentId, returnKey: back.key,
            };
            const steps = target === "summary" ? back.steps : back.steps - 1;
            if (steps > 0) {
              returningToAssignment = target === "summary" ? {} : { fallback: summary };
              win.history.go(-steps);
              return true;
            }
            replaceShellState(summary);
            return false;
          },
          registerController: (
            controller: ClassesDetailHistoryController,
          ): void => {
            classesDetailController = controller;
          },
        }
      : null,
    // Browser Back/Forward: Curriculum's nested Lesson Summary page.
    curriculumHistory: win
      ? {
          push: pushShellState,
          replace: replaceShellState,
          registerController: (controller: CurriculumHistoryController): void => {
            curriculumController = controller;
          },
        }
      : null,
    // Browser Back/Forward: My Units' archived view.
    unitsHistory: win && unitsEnabled
      ? {
          push: pushShellState,
          replace: replaceShellState,
          registerController: (controller: UnitsHistoryController): void => {
            unitsController = controller;
          },
        }
      : null,
    consumeArchivedUnitsIntent: (): boolean => {
      const intent = archivedUnitsIntent;
      archivedUnitsIntent = false;
      return intent;
    },
    consumeOpenUnitIntent: (): MyUnitsOpenUnitIntent | null => {
      const intent = openUnitIntent;
      openUnitIntent = null;
      return intent;
    },
    // Milestone 2A: Curriculum's "View unit" (and "Open My Units" from the
    // Add to Unit dialog). The same transition as the My Units nav item, so
    // it pushes one My Units history entry.
    openMyUnits: unitsEnabled
      ? (target: MyUnitsOpenUnitIntent | null): void => {
          openUnitIntent = target;
          navigateTo("units");
          openUnitIntent = null;
        }
      : null,
    consumeLessonResultsIntent: (): LessonResultsIntent | null => {
      const intent = lessonResultsIntent;
      lessonResultsIntent = null;
      return intent;
    },
    // A lesson's Results from outside the Curriculum grid: My Units' Results
    // action (Results pushes its own history entry) or Back from a class's
    // Assignment Detail (`restore`: the Results entry is still current).
    // Curriculum is mounted without a Curriculum entry of its own, so the
    // browser history gains exactly the Results entry, or (restore) the
    // Assignment Detail entry is REPLACED by the Results entry it came from.
    openLessonResults: (intent: LessonResultsIntent): void => {
      lessonResultsIntent = intent;
      navigateTo("curriculum", { fromPopstate: true });
      lessonResultsIntent = null;
      if (intent.restore) {
        replaceShellState({
          kind: "shell-lesson-summary",
          surface: "curriculum",
          lessonSlug: intent.lessonSlug,
          ...(intent.returnTo.kind === "units" ? { from: intent.returnTo.unit } : {}),
        });
      }
    },
    // Results opened from My Units: Back returns to that unit and REPLACES
    // the Results entry (the certified replace-never-back() pattern).
    returnToMyUnits: unitsEnabled
      ? (target: MyUnitsOpenUnitIntent): void => {
          openUnitIntent = target;
          navigateTo("units", { fromPopstate: true });
          openUnitIntent = null;
          replaceShellState(
            target.view === "results"
              ? { kind: "shell-unit-results", surface: "units", unitId: target.unitId, grade: target.grade }
              : { kind: "shell-surface", surface: "units" },
          );
        }
      : null,
    // Settings > Units: open My Units on its archived view. One history
    // entry (the archived view), like any other real navigation.
    openArchivedUnits: unitsEnabled
      ? (): void => {
          if (activeKey === "units" && !showingDetail) {
            if (unitsController?.restoreArchived(true) === true) {
              pushShellState({ kind: "shell-units-archived", surface: "units" });
            }
            return;
          }
          archivedUnitsIntent = true;
          navigateTo("units", { fromPopstate: true });
          pushShellState({ kind: "shell-units-archived", surface: "units" });
        }
      : null,
    // Browser Back/Forward: Settings' nested "Manage connection" page.
    settingsHistory: win
      ? {
          push: pushShellState,
          replace: replaceShellState,
          registerController: (controller: SettingsHistoryController): void => {
            settingsController = controller;
          },
        }
      : null,
    // Sprint 28.6F: the single class-management opener. Settings calls it to
    // open the shared Import / Create workflow; it records the intent and
    // performs the same navigation as clicking the Classes nav item, so both
    // Settings and Classes `+ Add a class` drive one implementation. Passing
    // no intent (or `null`) just lands on Classes, where the workflow lives.
    openClassManagement: (intent: ClassManagementIntent | null): void => {
      classManagementIntent = intent;
      navigateTo("classes");
    },
    // Sprint 28.6F: class-management intent one-shot (see above), consumed and
    // cleared by the next Classes mount.
    getClassManagementIntent: (): ClassManagementIntent | null =>
      classManagementIntent,
    setClassManagementIntent: (intent: ClassManagementIntent | null): void => {
      classManagementIntent = intent;
    },
    supportWorkspace: {
      isSupportOnly: (): boolean => supportOnly,
      setUnresolved: (unresolved: boolean): void => {
        if (workspaceUnresolved === unresolved) return;
        workspaceUnresolved = unresolved;
        renderNav();
      },
      takePrimedShared: (): Promise<ReadonlyArray<SharedStudent>> | null => {
        const primed = primedShared;
        primedShared = null;
        return primed;
      },
      enterSupportOnly: (): void => {
        enterSupportOnly();
      },
      leaveSupportOnly: (): void => {
        if (!supportOnly) return;
        supportOnly = false;
        renderNav();
      },
    },
  };

  // Enters the support-only presentation. Leaves any teaching-only surface
  // (or Assignment Detail overlay) for the Student Support landing, replacing
  // the current entry so Back never returns to the refused page.
  const enterSupportOnly = (): void => {
    if (supportOnly) return;
    supportOnly = true;
    classManagementIntent = null;
    archivedUnitsIntent = false;
    openUnitIntent = null;
    lessonResultsIntent = null;
    if (activeKey !== "classes" || showingDetail) {
      navigateTo("classes", { fromPopstate: true });
      replaceShellState({ kind: "shell-surface", surface: "classes" });
      return;
    }
    renderNav();
  };

  // Sprint 28.5D (D2A) / Sprint 28.6C: the single navigation transition, shared
  // by the nav items (onSelect) and the intra-shell navigateToSurface seam.
  // While Assignment Detail occupies the outlet, selecting the already-active
  // item is a real navigation that must clear Detail and re-mount the surface,
  // so the same-key early-return only applies when a surface (not Detail) is
  // showing. Selecting any item leaves Detail cleanly: the outlet is cleared
  // and the chosen surface mounts fresh.
  const navigateTo = (
    next: WorkspaceSurfaceKey,
    options?: {
      readonly fromPopstate?: boolean;
      readonly historyState?: ShellHistoryState;
      readonly workspaceReturn?: ClassWorkspaceReturn;
      readonly studentIntent?: ClassesStudentIntent;
    },
  ): void => {
    // Fails closed: My Units is never a destination unless it is enabled.
    if (next === "units" && !unitsEnabled) return;
    // A support-only teacher has no teaching-only destinations.
    if (workspaceUnresolved && next !== "classes") return;
    if (supportOnly && next !== "classes" && next !== "curriculum") return;
    const hasClassesHandoff = options?.workspaceReturn !== undefined || options?.studentIntent !== undefined;
    if (next === activeKey && !showingDetail && !hasClassesHandoff && outletHost.firstChild !== null) {
      // Selecting Curriculum while already in Curriculum (on a resource tab
      // or in Lesson Summary) returns to its landing view, Lessons. That is a
      // real user navigation, so it pushes one Curriculum entry; it is a
      // no-op (no push) when Lessons is already showing, so repeated clicks
      // never grow history.
      if (
        next === "curriculum" &&
        !options?.fromPopstate &&
        curriculumController?.restoreTop() === true
      ) {
        pushShellState({ kind: "shell-surface", surface: "curriculum" });
      }
      // Selecting My Units from its archived view returns to the active
      // units, the same way.
      if (
        next === "units" &&
        !options?.fromPopstate &&
        unitsController?.restoreArchived(false) === true
      ) {
        pushShellState({ kind: "shell-surface", surface: "units" });
      }
      return;
    }
    cancelNavigationRestore();
    showingDetail = false;
    // Browser Back/Forward support: leaving Classes (for any reason -
    // top nav, `navigateToSurface`, popstate) invalidates any registered
    // Student Detail restore controller. The next Classes mount registers
    // its own fresh one synchronously below if `next === "classes"`; for
    // every other target there must be no stale reference into the
    // torn-down render tree this `outletHost.textContent = ""` is about to
    // discard.
    classesDetailController = null;
    currentWorkspaceClassId = null;
    curriculumController = null;
    settingsController = null;
    unitsController = null;
    activeKey = next;
    outletHost.textContent = "";
    // The handoff belongs to this outlet only. A later Classes mount cannot
    // see it, even if this mount's class-list read has not settled yet.
    let workspaceReturn = options?.workspaceReturn ?? null;
    let studentIntent = options?.studentIntent ?? null;
    mountWorkspaceOutlet(outletHost, session, activeKey, {
      ...workspaceDeps,
      getClassesReturn: () => workspaceReturn,
      setClassesReturn: (value) => { workspaceReturn = value; },
      getClassesStudentIntent: () => studentIntent,
      setClassesStudentIntent: (value) => { studentIntent = value; },
    });
    renderNav();
    // Browser Back/Forward support: a popstate-driven call is restoring an
    // existing entry, never creating a new one. Real user-initiated
    // navigation pushes exactly one entry; the early return above already
    // prevents a duplicate push when the surface does not actually change.
    if (win && !options?.fromPopstate) {
      pushShellState(options?.historyState ?? { kind: "shell-surface", surface: next });
    }
  };

  const renderNav = (): void => {
    navMount.textContent = "";
    // Unresolved workspace: no navigation at all (Sign out is in the header).
    if (workspaceUnresolved) return;
    renderNavigation(navMount, {
      activeKey,
      unitsEnabled,
      supportOnly,
      onSelect: (next) => {
        navigateTo(next);
      },
    });
  };

  // Sprint 28.6D: attach the shell body to the (connected) mount BEFORE
  // rendering the initial workspace surface. Classes - the new default
  // landing surface - guards its first paint on `mount.isConnected`, so
  // the outlet host must already be in the document when the surface first
  // renders. Curriculum did not need this because its initial render is
  // unconditional; Classes-as-default does. DOM order is unchanged (header,
  // body, footer) because the footer is still appended after the body.
  mount.appendChild(body);

  // Milestone 1A: honor a fresh-load deep link, validated before the first
  // render so a refused destination never paints. My Units (and its archived
  // view) pass only the same `unitsEnabled` gate as navigation; otherwise the
  // request falls back to the default landing, except the legacy Curriculum
  // My Units entry, which keeps its fail-closed meaning (Curriculum).
  let initialState: ShellHistoryState = { kind: "shell-surface", surface: "classes" };
  const requested = deps.initialState ?? null;
  if (requested !== null) {
    switch (requested.kind) {
      case "shell-surface":
        if (requested.surface !== "units" || unitsEnabled) initialState = requested;
        break;
      case "shell-units-archived":
        if (unitsEnabled) {
          initialState = requested;
          archivedUnitsIntent = true;
        }
        break;
      case "shell-unit-results":
        // Fresh load of a Unit Results link: My Units opens on that unit's
        // grade and shows its Unit Results once the unit list confirms it.
        if (unitsEnabled) {
          initialState = requested;
          openUnitIntent = { unitId: requested.unitId, grade: requested.grade, view: "results" };
        }
        break;
      case "shell-curriculum-units":
        initialState = { kind: "shell-surface", surface: unitsEnabled ? "units" : "curriculum" };
        break;
      case "shell-lesson-summary":
      case "shell-curriculum-tab":
      case "shell-settings-integrations":
        initialState = requested;
        break;
      case "shell-classes-workspace":
      case "shell-assignment-detail":
        initialState = requested;
        break;
      case "shell-student-detail":
        initialState = requested;
        if (requested.originAssignmentId !== undefined) {
          const saved = currentHistoryState();
          initialState = saved?.kind === "shell-student-detail" &&
            hashForState(saved) === hashForState(requested) && saved.assignmentReturn !== undefined
            ? { ...requested, assignmentReturn: saved.assignmentReturn }
            : requested;
        }
        break;
    }
  }
  activeKey = initialState.surface;

  // Mounts the chosen initial surface, restores its nested destination, and
  // canonicalizes the current history entry.
  const mountInitial = (preserveHistory = false): void => {
    renderNav();
    mountWorkspaceOutlet(outletHost, session, activeKey, workspaceDeps);

    // Nested destinations restore through the controllers the surface just
    // registered; one that cannot be restored stays on its surface. (Assigned
    // in callbacks during the mount, so widen past TypeScript's narrowing.)
    const mountedCurriculum = curriculumController as CurriculumHistoryController | null;
    const mountedSettings = settingsController as SettingsHistoryController | null;
    if (initialState.kind === "shell-lesson-summary") {
      if (mountedCurriculum?.restoreLessonSummary(initialState.lessonSlug) !== true) {
        initialState = { kind: "shell-surface", surface: "curriculum" };
      }
    } else if (initialState.kind === "shell-curriculum-tab") {
      if (mountedCurriculum?.restoreTab(initialState.tab) !== true) {
        initialState = { kind: "shell-surface", surface: "curriculum" };
      }
    } else if (initialState.kind === "shell-settings-integrations") {
      if (mountedSettings?.restoreIntegrations() !== true) {
        initialState = { kind: "shell-surface", surface: "settings" };
      }
    }

    // Browser Back/Forward support: canonicalize the URL/history-state for
    // the surface actually chosen above (whether that came from a restored
    // hash or the default). This is state restoration, not a user-initiated
    // navigation, so it replaces the current entry rather than pushing one -
    // otherwise every shell mount (including a session `rerun`) would grow
    // the history stack with a redundant entry.
    if (win && !preserveHistory) {
      win.history.replaceState(
        initialState,
        "",
        urlWithHash(win.location.pathname, hashForState(initialState)),
      );
    }
    if (!preserveHistory && (
      initialState.kind === "shell-classes-workspace" ||
      initialState.kind === "shell-assignment-detail" ||
      initialState.kind === "shell-student-detail"
    )) {
      restoreHistoryDestination?.(initialState, true);
    }
  };

  // Student Support Workspace (V2 P3): Classes (the default landing) proves
  // the support-only condition from its own reads. A fresh load that asks
  // for a teaching-only surface must not paint it until the condition is
  // resolved, so the shell reads the owned classes first: any owned class
  // mounts the request at once (no wait on the shared read); zero classes
  // waits for the shared read. Both results are handed to the surface that
  // mounts next (`primedClasses` / `primedShared`), so neither is fetched
  // twice. Until then the outlet shows a neutral loading status and no
  // navigation. Without the support seam nothing changes.
  const supportSeam = readStudentSupportSeam();
  if (supportSeam !== null && (activeKey !== "classes" || supportSeam.isSupportWorkspaceEligible !== undefined)) {
    resolvingWorkspace = true;
    const pending = doc.createElement("p");
    pending.className = "shell-status";
    pending.setAttribute("role", "status");
    pending.setAttribute("aria-live", "polite");
    pending.setAttribute("data-testid", "shell-workspace-resolving");
    pending.textContent = "Loading your workspace";
    outletHost.appendChild(pending);
    const resolve = (supportOnlyResult: boolean | null, sharedFailed: boolean): void => {
      if (!body.isConnected || !resolvingWorkspace) return;
      resolvingWorkspace = false;
      outletHost.textContent = "";
      if (supportOnlyResult === true) supportOnly = true;
      if (sharedFailed) workspaceUnresolved = true;
      // Support-only, or zero classes with an unresolved (failed) shared
      // read: Classes, which shows the landing or the neutral retry state.
      if (supportOnlyResult === true || sharedFailed) {
        initialState = { kind: "shell-surface", surface: "classes" };
        activeKey = "classes";
      }
      const destination = pendingStartupDestination;
      pendingStartupDestination = undefined;
      if (destination != null) {
        // Replay before mounting the startup route so its initial replace
        // cannot overwrite the selected entry or consume the preflight read.
        archivedUnitsIntent = false;
        openUnitIntent = null;
        restoreHistoryDestination?.(destination);
      }
      // A refused traversal can leave the outlet empty. Mount the startup
      // fallback without replacing the entry the browser already selected.
      if (outletHost.firstChild === null) mountInitial(destination !== undefined);
      // A primed read not consumed by the surface just mounted is dropped,
      // so a later visit never receives a stale page-load result. (Classes
      // consumes the shared read only after its own class list arrives.)
      primedClasses = null;
      if (activeKey !== "classes") primedShared = null;
    };
    const readOwnedWorkspace = (): void => {
      const owned = deps.listClasses(session.uid);
      primedClasses = owned;
      owned.then(
        (classes) => {
          if (!body.isConnected || !resolvingWorkspace) return;
          if (classes.length > 0) {
            resolve(false, false);
            return;
          }
          const shared = supportSeam.listShared();
          primedShared = shared;
          shared.then(
            (students) => {
              const eligible = supportSeam.isSupportWorkspaceEligible?.() ?? isSupportOnlyTeacher(0, students.length);
              resolve(eligible, false);
              if (eligible || activeKey === "classes" || !supportSeam.reconcilePending) return;
              // The Classes surface handles its own post-reconciliation refresh.
              // A teacher arriving through another route needs the same redirect
              // if a new authorization activates after the initial grant read.
              void supportSeam.reconcilePending().then(async () => {
                if (!body.isConnected || activeKey === "classes") return;
                await supportSeam.listShared();
                if (body.isConnected && supportSeam.isSupportWorkspaceEligible?.()) enterSupportOnly();
              }).catch(() => undefined);
            },
            () => resolve(null, true),
          );
        },
        // The class list itself failed: mount the request, which reports its
        // own load failure.
        () => {
          primedClasses = null;
          if (supportSeam.isSupportWorkspaceEligible !== undefined) {
            pending.textContent = "We could not finish loading your workspace.";
            const retry = doc.createElement("button");
            retry.type = "button";
            retry.textContent = "Try again";
            retry.setAttribute("data-testid", "shell-workspace-retry");
            retry.addEventListener("click", () => {
              retry.remove();
              pending.textContent = "Loading your workspace";
              readOwnedWorkspace();
            });
            outletHost.appendChild(retry);
            return;
          }
          resolve(null, false);
        },
      );
    };
    readOwnedWorkspace();
  }

  renderFooter(mount);

  // Sprint 28.5D (D2A): register the shell's outlet with the entry-point
  // Assignment Detail opener so Detail renders inside this persistent shell
  // (header, navigation, footer preserved) rather than replacing `#app-root`.
  // `show` clears only the outlet's local content and hands back the host;
  // the active navigation key is left untouched so the surface the teacher
  // opened Detail from (Classes or Curriculum) stays the active context
  // while Detail is displayed. Guarded so a shell built
  // without the seam (or a harness that does not wire it) is unaffected.
  deps.assignmentDetail?.setOutletController?.({
    show: (render) => {
      if (!body.isConnected) return;
      cancelNavigationRestore();
      classesDetailController = null;
      showingDetail = true;
      outletHost.textContent = "";
      render(outletHost);
    },
  });

  // Student Progress & Assignment Membership Phase A, Slice 3: register the
  // student-selection controller the entry-point Assignment Detail opener
  // hands a roster-name click off to. Recording the intent then navigating
  // to Classes leaves Assignment Detail cleanly (the outlet is cleared and
  // Classes mounts fresh, exactly like any other `navigateToSurface` call)
  // and the fresh Classes mount consumes the intent to open Student Detail
  // pre-selected. Guarded so a shell built without the seam is unaffected.
  deps.assignmentDetail?.setStudentSelectionController?.({
    selectStudent: (selection) => {
      if (!body.isConnected || supportOnly || workspaceUnresolved) return;
      const origin = currentHistoryState();
      const matchingSummary = showingDetail && origin?.kind === "shell-assignment-detail" &&
        origin.classId === selection.classId && origin.assignmentId === selection.returnToAssignmentId;
      let key = matchingSummary ? origin.returnKey : undefined;
      if (win !== null && (key === undefined || assignmentReturns.get(key) !== "summary")) {
        key = win.crypto.getRandomValues(new Uint32Array(4)).join("-");
        if (matchingSummary) replaceShellState({ ...origin, returnKey: key });
        assignmentReturns.set(key, matchingSummary ? "summary" : "first-student");
      }
      navigateTo("classes", {
        studentIntent: selection,
        historyState: {
          kind: "shell-student-detail",
          surface: "classes",
          classId: selection.classId,
          studentId: selection.studentId,
          originAssignmentId: selection.returnToAssignmentId,
          ...(key !== undefined ? { assignmentReturn: { key, steps: 1 } } : {}),
        },
      });
    },
  });

  // Browser Back/Forward support: the single popstate restoration path.
  // `event.state` is untrusted input (see parseShellHistoryState) - a
  // malformed, foreign, or pre-feature entry is ignored outright rather
  // than guessed at, leaving the current UI exactly as it was.
  //
  // Never calls pushState/replaceState-as-navigation here: `navigateTo`'s
  // `fromPopstate: true` suppresses its own push. Three cases, one per
  // ShellHistoryState kind, each routing to the Classes surface first
  // (a no-op if already there) then asking the (possibly still-live)
  // controller to restore the corresponding depth:
  //   - "shell-surface": the flat Classes list (or another top-level
  //     surface) - `restoreToTopList` closes any open class workspace.
  //   - "shell-classes-workspace": a specific class's Students tab -
  //     `restoreWorkspace` opens/re-targets it and closes Detail if open.
  //   - "shell-student-detail": a specific student's Detail within the
  //     already-open workspace.
  // If the class/student named no longer resolves (roster not loaded,
  // wrong class open, or Classes was remounted since the entry was
  // pushed and a stale controller reference was already cleared by
  // `navigateTo`), restoration fails closed at whatever depth it could
  // reach rather than attempting a partial or incorrect nested restore.
  if (win) {
    // True when the Classes surface currently on screen can restore a
    // nested state in place. When it cannot (another surface, or Assignment
    // Summary occupies the outlet), a fresh Classes mount is needed; its
    // class list loads asynchronously, so the target class + section is
    // handed directly to the new mount, as with in-app "Back to class".
    const classesLive = (): boolean =>
      activeKey === "classes" && !showingDetail && classesDetailController !== null;

    const restoreClassWorkspace = (
      classId: string,
      section: ClassWorkspaceSection,
    ): void => {
      if (classesLive()) {
        const restored =
          classesDetailController?.restoreWorkspace(classId, section) ?? false;
        currentWorkspaceClassId = restored ? classId : null;
        return;
      }
      navigateTo("classes", {
        fromPopstate: true,
        workspaceReturn: { classId, tab: section === "setup" ? "assignments" : section },
      });
      currentWorkspaceClassId = classId;
    };

    restoreHistoryDestination = (destination, fromStartup = false): void => {
      const { fallback, restoredOrigin } = returningToAssignment ?? {};
      cancelNavigationRestore();
      const reachedRestoredOrigin = restoredOrigin !== undefined &&
        win.location.href === summaryUrl(restoredOrigin.classId, restoredOrigin.assignmentId);
      const verifiedReturn = reachedRestoredOrigin && destination?.kind === "shell-assignment-detail" &&
        destination.classId === restoredOrigin.classId && destination.assignmentId === restoredOrigin.assignmentId;
      if (reachedRestoredOrigin && !verifiedReturn && !supportOnly && !workspaceUnresolved) {
        // The preceding URL matched, but its classic history state is only
        // visible on arrival. Never restore a different or malformed route.
        const { classId } = restoredOrigin;
        replaceShellState({ kind: "shell-classes-workspace", surface: "classes", classId, section: "assignments" });
        restoreClassWorkspace(classId, "assignments");
        return;
      }
      if (destination === null) return;
      let parsed = destination;
      // A dialog is never left open over the page Back/Forward restores.
      dismissOpenModals();
      // While restricted, restore only Classes, shared Student Detail, and
      // preview-only Curriculum once the support workspace is authorized.
      // Replace stale teaching entries with the Student Support landing.
      if (
        (supportOnly || workspaceUnresolved) &&
        !(parsed.kind === "shell-surface" && (parsed.surface === "classes" || (supportOnly && parsed.surface === "curriculum"))) &&
        !(parsed.kind === "shell-student-detail" && parsed.originAssignmentId === undefined) &&
        !(supportOnly && parsed.kind === "shell-curriculum-tab")
      ) {
        navigateTo("classes", { fromPopstate: true });
        classesDetailController?.restoreToTopList();
        replaceShellState({ kind: "shell-surface", surface: "classes" });
        return;
      }
      if (parsed.surface === "units" && !unitsEnabled) return;
      if (
        fallback !== undefined &&
        ((parsed.kind === "shell-student-detail" &&
          parsed.classId === fallback.classId && parsed.originAssignmentId === fallback.assignmentId &&
          parsed.assignmentReturn?.key === fallback.returnKey && parsed.assignmentReturn?.steps === 1) ||
          (parsed.kind === "shell-classes-workspace" && parsed.classId === fallback.classId &&
            parsed.section === "assignments" && parsed.returnKey === fallback.returnKey))
      ) {
        replaceShellState(fallback);
        parsed = fallback;
      }
      switch (parsed.kind) {
        case "shell-surface": {
          navigateTo(parsed.surface, { fromPopstate: true });
          if (parsed.surface === "classes") {
            currentWorkspaceClassId = null;
            classesDetailController?.restoreToTopList();
          } else if (parsed.surface === "curriculum") {
            curriculumController?.restoreTop();
          } else if (parsed.surface === "units") {
            unitsController?.restoreTop();
          } else {
            settingsController?.restoreRoot();
          }
          return;
        }
        case "shell-classes-workspace":
          restoreClassWorkspace(parsed.classId, parsed.section);
          return;
        case "shell-assignment-detail": {
          if (!classesLive()) {
            navigateTo("classes", {
              fromPopstate: true,
              workspaceReturn: { classId: parsed.classId, tab: "assignments" },
            });
          }
          currentWorkspaceClassId = parsed.classId;
          // Fails closed (stays on the class's Assignments section) when the
          // assignment is not one this teacher's class lists.
          classesDetailController?.restoreAssignmentDetail(
            parsed.classId,
            parsed.assignmentId,
            fromStartup ? "startup" : verifiedReturn ? "student-return" : "history",
          );
          return;
        }
        case "shell-student-detail":
          if (parsed.originAssignmentId !== undefined) {
            const intent: ClassesStudentIntent = {
              classId: parsed.classId,
              studentId: parsed.studentId,
              returnToAssignmentId: parsed.originAssignmentId,
            };
            if (!classesLive() || !classesDetailController?.queueAssignmentStudent(intent)) {
              navigateTo("classes", { fromPopstate: true, studentIntent: intent });
            }
            currentWorkspaceClassId = parsed.classId;
            return;
          }
          // The Students tab of `parsed.classId` is the entry directly
          // beneath this one in every path that pushed it, so it is already
          // the open workspace by the time this fires via ordinary
          // sequential Back/Forward.
          navigateTo("classes", { fromPopstate: true });
          currentWorkspaceClassId = parsed.classId;
          classesDetailController?.restoreDetail(parsed.classId, parsed.studentId);
          return;
        case "shell-lesson-summary":
          navigateTo("curriculum", { fromPopstate: true });
          curriculumController?.restoreLessonSummary(parsed.lessonSlug, parsed.from);
          return;
        case "shell-curriculum-tab":
          navigateTo("curriculum", { fromPopstate: true });
          curriculumController?.restoreTab(parsed.tab);
          return;
        case "shell-curriculum-units":
          // Legacy entry from when My Units was a Curriculum tab: My Units
          // when enabled, else Curriculum (as before, when it failed closed).
          if (unitsEnabled) {
            navigateTo("units", { fromPopstate: true });
            unitsController?.restoreArchived(false);
          } else {
            navigateTo("curriculum", { fromPopstate: true });
          }
          return;
        case "shell-units-archived":
          if (activeKey === "units" && !showingDetail && unitsController !== null) {
            unitsController.restoreArchived(true);
          } else {
            archivedUnitsIntent = true;
            navigateTo("units", { fromPopstate: true });
          }
          return;
        case "shell-unit-results":
          if (activeKey === "units" && !showingDetail && unitsController !== null) {
            unitsController.restoreUnitResults(parsed.unitId, parsed.grade);
          } else {
            openUnitIntent = { unitId: parsed.unitId, grade: parsed.grade, view: "results" };
            navigateTo("units", { fromPopstate: true });
            openUnitIntent = null;
          }
          return;
        case "shell-settings-integrations":
          navigateTo("settings", { fromPopstate: true });
          settingsController?.restoreIntegrations();
          return;
      }
    };
    const handlePopstate = (event: PopStateEvent): void => {
      if (!body.isConnected) return;
      const destination = parseShellHistoryState(event.state);
      if (resolvingWorkspace) {
        pendingStartupDestination = destination;
      } else {
        restoreHistoryDestination?.(destination);
      }
    };
    activeShellPopstateCleanup?.();
    win.addEventListener("popstate", handlePopstate);
    activeShellPopstateCleanup = () => {
      cancelNavigationRestore();
      resolvingWorkspace = false;
      pendingStartupDestination = undefined;
      win.removeEventListener("popstate", handlePopstate);
    };
  }
  if (!resolvingWorkspace) mountInitial();
}
