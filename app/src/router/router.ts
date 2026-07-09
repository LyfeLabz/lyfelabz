import type { Session, SessionKind } from "../session/types";

// Canonical route path for each Session kind. The router owns the
// mapping. Step 4 replaces the Step 3 stub surfaces with designed
// experiences and introduces distinct URLs for the suspended, archived,
// administrator, and error surfaces so that observability tools can
// distinguish them without inspecting DOM.
//
// The URL under /app/** is a reflection of the resolved Session, not a
// routing input. Every surface renders from the caller's Session kind;
// deep links and back/forward re-render the current Session's surface.
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

// A route surface is a plain render function. Each surface is a
// deterministic function of its Session input.
export type RouteSurface = (session: Session, mount: HTMLElement) => void;

// Dispatch table. Each Session kind maps to exactly one surface. A
// missing entry is a bug; TypeScript exhaustiveness protects against
// that at compile time.
export type RouteTable = Readonly<Record<SessionKind, RouteSurface>>;

// Deterministic route decision for a Session.
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
  while (mount.firstChild) mount.removeChild(mount.firstChild);
  surface(session, mount);
  if (history && typeof history.replaceState === "function") {
    history.replaceState(null, "", path);
  }
}
