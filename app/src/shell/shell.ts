import type { Session } from "../session/types";
import { renderHeader } from "./header";
import { renderNavigation } from "./navigation";
import { renderFooter } from "./footer";
import { mountWorkspaceOutlet } from "./surfaces/workspace";

// Top-level teacher-platform shell mount.
//
// Consumes the immutable activeTeacher Session Object and renders the
// header, navigation, main content area (Home surface), and footer. The
// shell is a pure DOM builder: it opens no Firestore listeners, invokes
// no callables, and reads only fields already present on the Session.
// See SPRINT_3_STEP_5_SPECIFICATION.md.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type ShellDeps = {
  readonly onSignOut: () => void;
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

  renderNavigation(body);

  // The outer #app-root already carries role="main" on this page.
  // Rendering a nested <main> would be invalid HTML, so the workspace
  // outlet is a labelled <section> whose active surface owns the
  // #surface-headline referenced via aria-labelledby. Home is the only
  // active workspace surface in Sprint 6A. See
  // SPRINT_6A_SPECIFICATION.md.
  mountWorkspaceOutlet(body, session, "home");
  mount.appendChild(body);

  renderFooter(mount);
}
