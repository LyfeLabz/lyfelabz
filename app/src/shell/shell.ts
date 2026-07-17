import type { Session } from "../session/types";
import type { ListClasses } from "../classes/listClasses";
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
  };

  const renderNav = (): void => {
    navMount.textContent = "";
    renderNavigation(navMount, {
      activeKey,
      onSelect: (next) => {
        if (next === activeKey) return;
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
}
