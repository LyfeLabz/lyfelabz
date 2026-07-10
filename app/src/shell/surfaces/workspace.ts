import type { Session } from "../../session/types";
import type { ListClasses } from "../../classes/listClasses";
import type { WorkspaceSurfaceKey } from "../navigation";
import { renderCurriculumSurface } from "./curriculum";
import { renderClassesSurface } from "./classes";
import { renderComingSoonSurface } from "./shared/emptyState";

// Typed contract for a Teacher Workspace surface.
//
// A workspace surface is a self-contained region rendered inside the
// single shell outlet. It reads only fields already present on the
// activeTeacher Session Object or data retrieved through injected
// fetchers wired at the client entry point. It performs no Firestore
// reads and opens no listeners directly. See
// SPRINT_6A_SPECIFICATION.md, SPRINT_6B_COMPLETION_REPORT.md, and
// SPRINT_6C_SPECIFICATION.md.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type WorkspaceDeps = {
  readonly listClasses: ListClasses;
};

export type WorkspaceSurface = {
  readonly key: WorkspaceSurfaceKey;
  readonly render: (
    mount: HTMLElement,
    session: ActiveTeacher,
    deps: WorkspaceDeps,
  ) => void;
};

// Curriculum and Classes are the active surfaces in Sprint 6C. Present
// Mode and Settings remain unavailable and their outlet render paths
// are unreachable through the shell today; the coming-soon renderer
// exists so the contract is complete for future sprints.
export const WORKSPACE_SURFACES: Readonly<
  Record<WorkspaceSurfaceKey, WorkspaceSurface>
> = Object.freeze({
  curriculum: Object.freeze({
    key: "curriculum" as const,
    render: (
      mount: HTMLElement,
      session: ActiveTeacher,
      deps: WorkspaceDeps,
    ) =>
      renderCurriculumSurface(mount, session, { listClasses: deps.listClasses }),
  }),
  classes: Object.freeze({
    key: "classes" as const,
    render: (
      mount: HTMLElement,
      session: ActiveTeacher,
      deps: WorkspaceDeps,
    ) =>
      renderClassesSurface(mount, session, { listClasses: deps.listClasses }),
  }),
  "present-mode": Object.freeze({
    key: "present-mode" as const,
    render: (mount: HTMLElement) =>
      renderComingSoonSurface(mount, { title: "Present Mode" }),
  }),
  settings: Object.freeze({
    key: "settings" as const,
    render: (mount: HTMLElement) =>
      renderComingSoonSurface(mount, { title: "Settings" }),
  }),
});

// Mounts the single workspace outlet region and renders the surface
// registered for the given active key. The outlet is the sole content
// region inside the Teacher Workspace Shell; only one surface is
// mounted at a time.
export function mountWorkspaceOutlet(
  mount: HTMLElement,
  session: ActiveTeacher,
  activeKey: WorkspaceSurfaceKey,
  deps: WorkspaceDeps,
): HTMLElement {
  const doc = mount.ownerDocument;

  const outlet = doc.createElement("section");
  outlet.id = "app-main";
  outlet.className = "shell-main";
  outlet.setAttribute("aria-labelledby", "surface-headline");
  outlet.setAttribute("data-testid", "workspace-outlet");
  outlet.setAttribute("data-active-surface", activeKey);

  mount.appendChild(outlet);
  const surface = WORKSPACE_SURFACES[activeKey];
  surface.render(outlet, session, deps);
  return outlet;
}
