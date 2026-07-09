import type { Session, SessionKind } from "../session/types";

// Canonical route path for each Session kind. The router owns the
// mapping. Sprint 3 surfaces are stubs; Step 4 replaces the placeholder
// stubs at /app/signin, /app/onboarding, and /app/pending with the real
// sign-in, role picker, and pending screen.
//
// Approved Sprint 3 route set (SPRINT_3_STEP_1_SPECIFICATION.md §5):
//   /app/, /app/signin, /app/onboarding, /app/pending, /app/teacher,
//   /app/student.
//
// Session kinds without an approved landing route (activeAdministrator,
// suspendedUser, archivedUser) fail closed to /app/signin. New landing
// routes require an approved architecture amendment before they are
// introduced.
export const ROUTE_FOR_KIND: Readonly<Record<SessionKind, string>> = Object.freeze({
  unauthenticated: "/app/signin",
  provisioned: "/app/onboarding",
  pendingVerification: "/app/pending",
  activeTeacher: "/app/teacher",
  activeStudent: "/app/student",
  activeAdministrator: "/app/signin",
  suspendedUser: "/app/signin",
  archivedUser: "/app/signin",
  error: "/app/signin",
});

// A route surface is a plain render function. Sprint 3 keeps them
// deliberately minimal: each stub renders a small piece of DOM into the
// caller-supplied mount node. Real UI is later work.
export type RouteSurface = (session: Session, mount: HTMLElement) => void;

// Dispatch table. Each Session kind maps to exactly one surface. A
// missing entry is a bug; the router's default-case triggers the
// unauthenticated surface as a fail-closed default.
export type RouteTable = Readonly<Record<SessionKind, RouteSurface>>;

// Deterministic route decision for a Session. Sprint 3 spec §11-§16
// requires that every /app/** path collapses to the caller's Session
// kind, so the current URL is deliberately ignored here; the router
// updates history to reflect the resolved kind.
export function routeForSession(session: Session): string {
  return ROUTE_FOR_KIND[session.kind];
}

// Renders the appropriate surface for the given Session. Uses
// history.replaceState to update the URL without a navigation. Never
// throws on unknown kinds because Session is a closed union.
export function dispatch(
  session: Session,
  table: RouteTable,
  mount: HTMLElement,
  history?: { replaceState: History["replaceState"] },
): void {
  const path = routeForSession(session);
  const surface = table[session.kind];
  // Clear previous surface before rendering the next.
  while (mount.firstChild) mount.removeChild(mount.firstChild);
  surface(session, mount);
  if (history && typeof history.replaceState === "function") {
    history.replaceState(null, "", path);
  }
}
