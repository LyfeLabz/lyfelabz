import type { Session } from "../../session/types";
import type { ListClasses } from "../../classes/listClasses";
import type { NavigationKey } from "../navigation";
import { renderHomeSurface } from "./home";
import { renderClassesSurface } from "./classes";
import { renderComingSoonSurface } from "./shared/emptyState";

// Typed contract for a Teacher Platform workspace surface.
//
// A workspace surface is a self-contained region rendered inside the
// single shell outlet. It reads only fields already present on the
// activeTeacher Session Object or data retrieved through injected
// fetchers wired at the client entry point. It performs no Firestore
// reads and opens no listeners directly. See
// SPRINT_6A_SPECIFICATION.md and SPRINT_6B_SPECIFICATION.md.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type WorkspaceDeps = {
  readonly listClasses: ListClasses;
};

export type WorkspaceSurface = {
  readonly key: NavigationKey;
  readonly render: (
    mount: HTMLElement,
    session: ActiveTeacher,
    deps: WorkspaceDeps,
  ) => void;
};

// Home and Classes are the active surfaces in Sprint 6B. Every other
// navigation key remains unavailable and its outlet render path is
// unreachable through the shell today; the coming-soon renderer exists
// so the contract is complete for future sprints.
export const WORKSPACE_SURFACES: Readonly<Record<NavigationKey, WorkspaceSurface>> =
  Object.freeze({
    home: Object.freeze({
      key: "home",
      render: (mount: HTMLElement, session: ActiveTeacher) =>
        renderHomeSurface(mount, session),
    }),
    classes: Object.freeze({
      key: "classes",
      render: (
        mount: HTMLElement,
        session: ActiveTeacher,
        deps: WorkspaceDeps,
      ) =>
        renderClassesSurface(mount, session, { listClasses: deps.listClasses }),
    }),
    students: Object.freeze({
      key: "students",
      render: (mount: HTMLElement) =>
        renderComingSoonSurface(mount, { title: "Students" }),
    }),
    assignments: Object.freeze({
      key: "assignments",
      render: (mount: HTMLElement) =>
        renderComingSoonSurface(mount, { title: "Assignments" }),
    }),
    settings: Object.freeze({
      key: "settings",
      render: (mount: HTMLElement) =>
        renderComingSoonSurface(mount, { title: "Settings" }),
    }),
  });

// Mounts the single workspace outlet region and renders the surface
// registered for the given active key. The outlet is the sole content
// region inside the Teacher Platform Shell; only one surface is mounted
// at a time.
export function mountWorkspaceOutlet(
  mount: HTMLElement,
  session: ActiveTeacher,
  activeKey: NavigationKey,
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
