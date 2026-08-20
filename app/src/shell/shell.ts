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
import type { CurriculumAssignmentDetailSeam } from "./surfaces/curriculum";
import type { AssignmentSummaryCallable } from "../assignments/summary/types";
import type {
  TeacherDefaultGrade,
  UpdateTeacherDefaultGrade,
} from "../teacherPreferences/types";

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
// §3.3. The default landing surface is Curriculum. See
// SPRINT_6C_SPECIFICATION.md §7.

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
  // Sprint 20 internal beta: injected create-class callable seam.
  readonly createClass?: CreateClass | null;
  // Sprint 24B Phase 2: injected dependencies for the primary Import
  // Class from Google Classroom flow.
  readonly importFromClassroom?: ImportFromClassroomDeps | null;
  // Sprint 24B Phase 2B.2: resolved teacher `defaultGrade` preference
  // and best-effort update seam. Threaded through workspace deps to the
  // Classes and Settings surfaces. Null when the reader failed or no
  // preference is stored.
  readonly defaultGrade?: TeacherDefaultGrade | null;
  readonly updateDefaultGrade?: UpdateTeacherDefaultGrade | null;
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

  let activeKey: WorkspaceSurfaceKey = "curriculum";
  // Sprint 28.5D (D2A): true while an overlay surface (Assignment Detail)
  // occupies the outlet in place of the active workspace surface. Curriculum
  // remains the active navigation context throughout, but a nav click on the
  // already-active item must still re-mount that surface to leave the
  // overlay, so the normal same-key early-return is suspended while this is
  // set. This is a single bounded flag, not a navigation state machine.
  let showingDetail = false;
  const navMount = doc.createElement("div");
  navMount.className = "shell-nav-mount";
  body.appendChild(navMount);
  const outletHost = doc.createElement("div");
  outletHost.className = "shell-outlet-host";
  body.appendChild(outletHost);

  const workspaceDeps = {
    listClasses: deps.listClasses,
    onLaunchPresentMode: deps.onLaunchPresentMode,
    snapshotPreview: deps.snapshotPreview ?? null,
    integrations: deps.integrations ?? null,
    assignments: deps.assignments ?? null,
    assignmentDetail: deps.assignmentDetail ?? null,
    assignmentSummary: deps.assignmentSummary ?? null,
    createClass: deps.createClass ?? null,
    importFromClassroom: deps.importFromClassroom ?? null,
    defaultGrade: deps.defaultGrade ?? null,
    updateDefaultGrade: deps.updateDefaultGrade ?? null,
    activateClass: deps.activateClass ?? null,
    syncRoster: deps.syncRoster ?? null,
  };

  const renderNav = (): void => {
    navMount.textContent = "";
    renderNavigation(navMount, {
      activeKey,
      onSelect: (next) => {
        // Sprint 28.5D (D2A): while Assignment Detail occupies the outlet,
        // selecting the already-active item (Curriculum) is a real
        // navigation that must clear Detail and re-mount the surface, so the
        // same-key early-return only applies when a surface (not Detail) is
        // showing. Selecting any item leaves Detail cleanly: the outlet is
        // cleared and the chosen surface mounts fresh.
        if (next === activeKey && !showingDetail) return;
        showingDetail = false;
        activeKey = next;
        outletHost.textContent = "";
        mountWorkspaceOutlet(outletHost, session, activeKey, workspaceDeps);
        renderNav();
      },
    });
  };

  renderNav();
  mountWorkspaceOutlet(outletHost, session, activeKey, workspaceDeps);

  mount.appendChild(body);

  renderFooter(mount);

  // Sprint 28.5D (D2A): register the shell's outlet with the entry-point
  // Assignment Detail opener so Detail renders inside this persistent shell
  // (header, navigation, footer preserved) rather than replacing `#app-root`.
  // `show` clears only the outlet's local content and hands back the host;
  // the active navigation key is left untouched so Curriculum stays the
  // active context while Detail is displayed. Guarded so a shell built
  // without the seam (or a harness that does not wire it) is unaffected.
  deps.assignmentDetail?.setOutletController?.({
    show: (render) => {
      showingDetail = true;
      outletHost.textContent = "";
      render(outletHost);
    },
  });
}
