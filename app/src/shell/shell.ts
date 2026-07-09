import type { Session } from "../session/types";
import { renderHeader } from "./header";
import { renderNavigation } from "./navigation";
import { renderFooter } from "./footer";
import { renderHomeSurface } from "./surfaces/home";

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
  // Rendering a nested <main> would be invalid HTML, so we use a
  // labelled <section> as the content area and reference the Home
  // surface headline via aria-labelledby. See implementation notes.
  const contentArea = doc.createElement("section");
  contentArea.id = "app-main";
  contentArea.className = "shell-main";
  contentArea.setAttribute("aria-labelledby", "surface-headline");
  contentArea.setAttribute("data-testid", "shell-main");

  renderHomeSurface(contentArea, session);

  body.appendChild(contentArea);
  mount.appendChild(body);

  renderFooter(mount);
}
