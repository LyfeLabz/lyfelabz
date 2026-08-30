import type { Session } from "../session/types";
import type { ListClasses } from "../classes/listClasses";
import type { CreateClass } from "../classes/createClass";
import type { ActivateClass } from "../classes/activateClass";
import type { SyncRoster } from "../classes/syncRoster";
import type { ImportFromClassroomDeps } from "../classes/importFromClassroom";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
} from "../settings/integrations/types";
import { renderHeader } from "./header";
import { renderNavigation, type WorkspaceSurfaceKey } from "./navigation";
import { renderFooter } from "./footer";
import { mountWorkspaceOutlet } from "./surfaces/workspace";
import type { SnapshotPreview } from "./surfaces/snapshot";
import type {
  ClassManagementIntent,
  ClassWorkspaceReturn,
} from "./surfaces/classes";
import type { CurriculumAssignmentDetailSeam } from "./surfaces/curriculum";
import type {
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "../assignments/summary/types";

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
};

export function mountTeacherShell(
  session: ActiveTeacher,
  mount: HTMLElement,
  deps: ShellDeps,
): void {
  const doc = mount.ownerDocument;

  renderHeader(mount, session, { onSignOut: deps.onSignOut });

  const body = doc.createElement("div");
  body.className = "shell-body";
  body.setAttribute("data-testid", "shell-body");

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

  const workspaceDeps = {
    listClasses: deps.listClasses,
    onLaunchPresentMode: deps.onLaunchPresentMode,
    snapshotPreview: deps.snapshotPreview ?? null,
    integrations: deps.integrations ?? null,
    assignments: deps.assignments ?? null,
    assignmentDetail: deps.assignmentDetail ?? null,
    assignmentSummary: deps.assignmentSummary ?? null,
    lessonSummary: deps.lessonSummary ?? null,
    createClass: deps.createClass ?? null,
    importFromClassroom: deps.importFromClassroom ?? null,
    activateClass: deps.activateClass ?? null,
    syncRoster: deps.syncRoster ?? null,
    // Sprint 28.6C: bounded intra-shell navigation seam. A workspace surface
    // (Classes) uses it to request a surface switch - e.g. the empty
    // Assignments state routing to Curriculum, and the Assignment Detail
    // return routing back to Classes. It performs exactly the same transition
    // as clicking the corresponding nav item.
    navigateToSurface: (next: WorkspaceSurfaceKey): void => {
      navigateTo(next);
    },
    // Sprint 28.6C: class-workspace return-location seam (see `classesReturn`).
    getClassesReturn: (): ClassWorkspaceReturn | null => classesReturn,
    setClassesReturn: (loc: ClassWorkspaceReturn | null): void => {
      classesReturn = loc;
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
  const navigateTo = (next: WorkspaceSurfaceKey): void => {
    if (next === activeKey && !showingDetail) return;
    showingDetail = false;
    activeKey = next;
    outletHost.textContent = "";
    mountWorkspaceOutlet(outletHost, session, activeKey, workspaceDeps);
    renderNav();
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
}
