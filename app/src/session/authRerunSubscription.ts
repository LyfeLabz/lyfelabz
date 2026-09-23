// Startup lifecycle for the authenticated app shell.
//
// The entry point performs ONE initial bootstrap (`rerun`) and then
// subscribes to Firebase Auth state changes so a later sign-in / sign-out
// re-bootstraps. Firebase's `onAuthStateChanged` invokes its callback
// immediately upon registration with the CURRENT user - the same user the
// initial bootstrap just resolved. Rerunning on that initial notification
// bootstrapped and dispatched the same surface a second time (measured in
// production: duplicate student-list / teacher-list calls on a large share of
// loads, each duplicate able to spin up an extra cold server instance).
//
// This module owns that rule in one place: a notification triggers a rerun
// only when the signed-in identity actually differs from the one the app
// last bootstrapped for. Sign-out (uid -> null), sign-in (null -> uid), and
// an account switch (uid A -> uid B) all still rerun. Token refreshes do not
// reach `onAuthStateChanged` at all, and the flows that must re-bootstrap
// for the SAME user (activation / onboarding) already call `rerun` directly.
// Nothing here makes an authorization decision; it only decides whether an
// auth-change notification represents a change.

export type AuthIdentity = { readonly uid: string } | null;

export type SubscribeAuthRerunDeps = {
  // The identity the initial bootstrap resolved (null when signed out).
  readonly bootstrappedUid: string | null;
  // Firebase `onAuthStateChanged` bound to the app's auth instance.
  readonly onAuthStateChanged: (
    callback: (user: AuthIdentity) => void,
  ) => () => void;
  readonly rerun: () => void;
};

export function subscribeAuthRerun(deps: SubscribeAuthRerunDeps): () => void {
  let lastUid: string | null = deps.bootstrappedUid;
  return deps.onAuthStateChanged((user) => {
    const uid = user?.uid ?? null;
    if (uid === lastUid) return;
    lastUid = uid;
    deps.rerun();
  });
}
