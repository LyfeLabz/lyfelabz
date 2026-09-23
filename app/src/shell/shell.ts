import type { Session } from "../session/types";
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
import type { AttemptsListForClassCallable } from "../assignments/detail/attempts-wire";
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
  parseShellHistoryState,
  hashForState,
  hashForSurface,
  urlWithHash,
} from "./navigationHistory";
import { dismissOpenModals } from "./openModals";
import { mountWorkspaceOutlet } from "./surfaces/workspace";
import type { SnapshotPreview } from "./surfaces/snapshot";
import type {
  ClassManagementIntent,
  ClassWorkspaceReturn,
  StudentDetailHistorySeam,
} from "./surfaces/classes";

type ClassesHistoryNotify = Parameters<StudentDetailHistorySeam["notify"]>[0];
import type {
  CurriculumAssignmentDetailSeam,
  AssignmentDetailStudentSelection,
} from "./surfaces/curriculum";
import type {
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../assignments/summary/types";
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
  readonly lessonSummary?: LessonSummaryCallable | null;
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

type ClassesDetailHistoryController = {
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
};

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

  // Browser Back/Forward support: the default landing surface is
  // deliberately never read from `window.location` on mount. `dispatch`
  // (router.ts) issues its own `replaceState(null, "", path)` immediately
  // after this function returns, using a bare session-kind pathname with
  // no hash - it would silently discard any hash-derived initial surface
  // choice made here on every session `rerun`, and reading ambient
  // `window.location` state as a mount-time input is also observably
  // unsafe in a single-page-app test harness, where one jsdom `window` is
  // reused across sequential shell mounts. Cold refresh/direct-URL
  // restoration of a specific top-level surface is therefore explicitly
  // out of scope for this patch; only in-session Back/Forward is
  // supported. See navigationHistory.ts.
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

  // Sprint 28.6C: shell-owned, ephemeral class-workspace return location. The
  // Classes surface records where it was (selected class + section) just before
  // it opens Assignment Detail, so returning from Detail re-lands in that
  // class's Assignments context instead of the class list or Curriculum. It is
  // a one-shot: the next Classes mount consumes and clears it. Living on the
  // shell instance (not module scope) means it cannot leak across sessions or
  // between tests, and a fresh shell always starts with the class list.
  let classesReturn: ClassWorkspaceReturn | null = null;

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

  // Student Progress & Assignment Membership Phase A, Slice 3: shell-owned,
  // ephemeral student-selection intent. Assignment Detail has no shared
  // closure with Classes (it renders into this shell's outlet directly, see
  // `setOutletController` below), so a roster-name click there hands off
  // through this one-shot: the entry-point opener records the selection
  // here and navigates to Classes, and the next Classes mount consumes and
  // clears it, seeding Student Detail pre-selected with an
  // assignment-origin `studentDetailOrigin` so Back returns to that exact
  // assignment. Mirrors `classesReturn`'s one-shot shape exactly. Living on
  // the shell instance means it cannot leak across sessions or tests.
  let classesStudentIntent: AssignmentDetailStudentSelection | null = null;

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

  // Browser Back/Forward: the single push/replace path for every history
  // state, so each entry's URL is derived by the one mapping in
  // navigationHistory.ts (`hashForState`). No-ops without a window.
  const pushShellState = (state: ShellHistoryState): void => {
    win?.history.pushState(state, "", urlWithHash(win.location.pathname, hashForState(state)));
  };
  const replaceShellState = (state: ShellHistoryState): void => {
    win?.history.replaceState(state, "", urlWithHash(win.location.pathname, hashForState(state)));
  };

  const workspaceDeps = {
    listClasses: deps.listClasses,
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
    createClass: deps.createClass ?? null,
    importFromClassroom: deps.importFromClassroom ?? null,
    activateClass: deps.activateClass ?? null,
    syncRoster: deps.syncRoster ?? null,
    refreshRoster: deps.refreshRoster ?? null,
    loadRoster: deps.loadRoster ?? null,
    loadAttempts: deps.loadAttempts ?? null,
    loadExpectedAssignments: deps.loadExpectedAssignments ?? null,
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
              pushShellState({
                kind: "shell-student-detail",
                surface: "classes",
                classId: input.classId,
                studentId: input.studentId,
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
            } else {
              // exit-assignment-detail (in-app "Back to class"): leave the
              // Summary overlay for a fresh Classes mount, which consumes the
              // `classesReturn` one-shot the opener recorded and re-lands on
              // that class's Assignments section. The Summary entry is
              // REPLACED with the class Assignments entry - never a blind
              // `history.back()`.
              navigateTo("classes", { fromPopstate: true });
              currentWorkspaceClassId = input.classId;
              replaceShellState({
                kind: "shell-classes-workspace",
                surface: "classes",
                classId: input.classId,
                section: "assignments",
              });
            }
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
    // Sprint 28.6C: class-workspace return-location seam (see `classesReturn`).
    getClassesReturn: (): ClassWorkspaceReturn | null => classesReturn,
    setClassesReturn: (loc: ClassWorkspaceReturn | null): void => {
      classesReturn = loc;
    },
    // Student Progress & Assignment Membership Phase A, Slice 3:
    // student-selection intent one-shot (see `classesStudentIntent`).
    getClassesStudentIntent: (): AssignmentDetailStudentSelection | null =>
      classesStudentIntent,
    setClassesStudentIntent: (
      intent: AssignmentDetailStudentSelection | null,
    ): void => {
      classesStudentIntent = intent;
    },
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
    options?: { readonly fromPopstate?: boolean },
  ): void => {
    if (next === activeKey && !showingDetail) return;
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
    activeKey = next;
    outletHost.textContent = "";
    mountWorkspaceOutlet(outletHost, session, activeKey, workspaceDeps);
    renderNav();
    // Browser Back/Forward support: a popstate-driven call is restoring an
    // existing entry, never creating a new one. Real user-initiated
    // navigation pushes exactly one entry; the early return above already
    // prevents a duplicate push when the surface does not actually change.
    if (win && !options?.fromPopstate) {
      pushShellState({ kind: "shell-surface", surface: next });
    }
  };

  const renderNav = (): void => {
    navMount.textContent = "";
    renderNavigation(navMount, {
      activeKey,
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

  renderNav();
  mountWorkspaceOutlet(outletHost, session, activeKey, workspaceDeps);

  // Browser Back/Forward support: canonicalize the URL/history-state for
  // the surface actually chosen above (whether that came from a restored
  // hash or the default). This is state restoration, not a user-initiated
  // navigation, so it replaces the current entry rather than pushing one -
  // otherwise every shell mount (including a session `rerun`) would grow
  // the history stack with a redundant entry.
  if (win) {
    const initialState: ShellHistoryState = {
      kind: "shell-surface",
      surface: activeKey,
    };
    win.history.replaceState(
      initialState,
      "",
      urlWithHash(win.location.pathname, hashForSurface(activeKey)),
    );
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
      classesStudentIntent = selection;
      navigateTo("classes");
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
    // handed over through the same `classesReturn` one-shot the in-app
    // "Back to class" uses, which the mount applies once classes load.
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
      classesReturn = { classId, tab: section === "setup" ? "assignments" : section };
      navigateTo("classes", { fromPopstate: true });
      currentWorkspaceClassId = classId;
    };

    const handlePopstate = (event: PopStateEvent): void => {
      const parsed = parseShellHistoryState(event.state);
      if (parsed === null) return;
      // A dialog is never left open over the page Back/Forward restores.
      dismissOpenModals();
      switch (parsed.kind) {
        case "shell-surface": {
          navigateTo(parsed.surface, { fromPopstate: true });
          if (parsed.surface === "classes") {
            currentWorkspaceClassId = null;
            classesDetailController?.restoreToTopList();
          } else if (parsed.surface === "curriculum") {
            curriculumController?.restoreTop();
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
            classesReturn = { classId: parsed.classId, tab: "assignments" };
            navigateTo("classes", { fromPopstate: true });
          }
          currentWorkspaceClassId = parsed.classId;
          // Fails closed (stays on the class's Assignments section) when the
          // assignment is not one this teacher's class lists.
          classesDetailController?.restoreAssignmentDetail(
            parsed.classId,
            parsed.assignmentId,
          );
          return;
        }
        case "shell-student-detail":
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
          curriculumController?.restoreLessonSummary(parsed.lessonSlug);
          return;
        case "shell-settings-integrations":
          navigateTo("settings", { fromPopstate: true });
          settingsController?.restoreIntegrations();
          return;
      }
    };
    activeShellPopstateCleanup?.();
    win.addEventListener("popstate", handlePopstate);
    activeShellPopstateCleanup = () => {
      win.removeEventListener("popstate", handlePopstate);
    };
  }
}
