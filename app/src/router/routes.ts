import type { RouteTable } from "./router";
import {
  makeActiveAdministratorSurface,
  makeActiveStudentSurface,
  makeActiveTeacherSurface,
  makeArchivedSurface,
  makeErrorSurface,
  makePendingSurface,
  makeProvisionedSurface,
  makeSignedOutSurface,
  makeSuspendedSurface,
  type SurfaceDeps,
} from "./surfaces";

// Constructs the Step 4 route table. Each entry is the surface that
// renders when the Canonical Session Bootstrap resolves to that kind.
//
// Surfaces receive their side-effectful dependencies through `deps` so
// that the surfaces themselves stay pure DOM builders with no Firebase
// imports. The entry point wires the real implementations; unit tests
// pass in-memory fakes.
export function createRouteTable(deps: SurfaceDeps): RouteTable {
  return Object.freeze({
    unauthenticated: makeSignedOutSurface(deps),
    provisioned: makeProvisionedSurface(deps),
    pendingVerification: makePendingSurface(deps),
    activeTeacher: makeActiveTeacherSurface(deps),
    activeStudent: makeActiveStudentSurface(deps),
    activeAdministrator: makeActiveAdministratorSurface(deps),
    suspendedUser: makeSuspendedSurface(deps),
    archivedUser: makeArchivedSurface(deps),
    error: makeErrorSurface(deps),
  });
}

// Backwards-compatible sign-out-only overload used by the existing
// bootstrap entry point tests. The router.test.ts fixtures construct
// the table with a single sign-out callback; §4 dependencies default to
// no-ops that reject so no test accidentally invokes them silently.
export function createSignOutOnlyRouteTable(
  onSignOut: () => void,
): RouteTable {
  const rejectMissing = (): Promise<never> =>
    Promise.reject(new Error("dep not wired"));
  return createRouteTable({
    onSignOut,
    onSignIn: rejectMissing,
    onRefreshSession: rejectMissing,
    onRequestVerification: rejectMissing,
  });
}
