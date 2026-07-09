import type { Session } from "../session/types";
import type { ListClasses } from "../classes/listClasses";
import { renderHeader } from "./header";
import { renderNavigation, type NavigationKey } from "./navigation";
import { renderFooter } from "./footer";
import { mountWorkspaceOutlet } from "./surfaces/workspace";

// Top-level teacher-platform shell mount.
//
// Consumes the immutable activeTeacher Session Object and renders the
// header, navigation, workspace outlet, and footer. The shell is a pure
// DOM builder: it opens no Firestore listeners, invokes no callables,
// and reads only fields already present on the Session or data
// retrieved through injected fetchers wired at the client entry point.
// See SPRINT_3_STEP_5_SPECIFICATION.md, SPRINT_6A_SPECIFICATION.md, and
// SPRINT_6B_SPECIFICATION.md.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type ShellDeps = {
  readonly onSignOut: () => void;
  readonly listClasses: ListClasses;
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

  let activeKey: NavigationKey = "home";
  const navMount = doc.createElement("div");
  navMount.className = "shell-nav-mount";
  body.appendChild(navMount);
  const outletHost = doc.createElement("div");
  outletHost.className = "shell-outlet-host";
  body.appendChild(outletHost);

  const workspaceDeps = { listClasses: deps.listClasses };

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
