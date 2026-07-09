import type { Session } from "../session/types";
import type { RouteSurface, RouteTable } from "./router";

// Sprint 3 stubs. Every surface below renders only the minimum needed to
// prove the router routes the caller correctly. Real sign-in, onboarding,
// pending, teacher, and student UI belong to Sprint 3 Steps 4 and 5.
//
// Session kinds without an approved landing surface (activeAdministrator,
// suspendedUser, archivedUser) fall back to the approved sign-in surface.
// Introducing bespoke surfaces for those kinds requires an approved
// architecture amendment.

const setHeading = (mount: HTMLElement, text: string): HTMLElement => {
  const h1 = mount.ownerDocument.createElement("h1");
  h1.textContent = text;
  mount.appendChild(h1);
  return h1;
};

const setLine = (mount: HTMLElement, text: string): HTMLElement => {
  const p = mount.ownerDocument.createElement("p");
  p.textContent = text;
  mount.appendChild(p);
  return p;
};

const setSignOut = (
  mount: HTMLElement,
  onSignOut: () => void,
): HTMLButtonElement => {
  const btn = mount.ownerDocument.createElement("button");
  btn.type = "button";
  btn.textContent = "Sign out";
  btn.setAttribute("data-testid", "sign-out");
  btn.addEventListener("click", () => onSignOut());
  mount.appendChild(btn);
  return btn;
};

export const signinSurface: RouteSurface = (session, mount) => {
  setHeading(mount, "Sign in");
  if (session.kind === "error") {
    const banner = mount.ownerDocument.createElement("p");
    banner.setAttribute("role", "alert");
    banner.setAttribute("data-testid", "error-banner");
    banner.textContent =
      "We could not load your account. Please sign in again.";
    mount.appendChild(banner);
  }
};

export const onboardingSurface: RouteSurface = (_session, mount) => {
  setHeading(mount, "Welcome to LyfeLabz");
  setLine(mount, "Onboarding placeholder");
};

export const pendingSurface: RouteSurface = (session, mount) => {
  setHeading(mount, "Awaiting verification");
  if (session.kind === "pendingVerification") {
    setLine(mount, session.displayName);
  }
};

const activeSurface =
  (title: string): RouteSurface =>
  (session, mount) => {
    setHeading(mount, title);
    if (
      session.kind === "activeTeacher" ||
      session.kind === "activeStudent"
    ) {
      setLine(mount, session.displayName);
      setLine(mount, session.schoolId);
    }
  };

export const teacherSurface: RouteSurface = activeSurface("Teacher");
export const studentSurface: RouteSurface = activeSurface("Student");

// Route table factory. The factory takes a sign-out handler so route
// surfaces do not import the Firebase Auth module directly.
export function createRouteTable(onSignOut: () => void): RouteTable {
  const withSignOut =
    (inner: RouteSurface): RouteSurface =>
    (session: Session, mount: HTMLElement) => {
      inner(session, mount);
      if (session.kind !== "unauthenticated") {
        setSignOut(mount, onSignOut);
      }
    };

  return Object.freeze({
    unauthenticated: signinSurface,
    provisioned: withSignOut(onboardingSurface),
    pendingVerification: withSignOut(pendingSurface),
    activeTeacher: withSignOut(teacherSurface),
    activeStudent: withSignOut(studentSurface),
    activeAdministrator: signinSurface,
    suspendedUser: signinSurface,
    archivedUser: signinSurface,
    error: signinSurface,
  });
}
