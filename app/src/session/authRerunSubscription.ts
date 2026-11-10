// Startup lifecycle for the authenticated app shell.
//
// The entry point subscribes to Firebase Auth state changes and then performs
// ONE initial bootstrap (`rerun`); a later sign-in / sign-out re-bootstraps.
// Firebase's `onAuthStateChanged` invokes its callback once auth initializes
// with the CURRENT user - the same user the initial bootstrap is resolving. Rerunning on that initial notification
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
//
// The subscription is installed BEFORE the initial bootstrap, so an account
// change while that bootstrap is still waiting (on the user record or token)
// is observed rather than missed. Each bootstrap then asks `check` whether
// the identity it resolved is still the signed-in one before it installs
// anything; a stale completion installs nothing.

export type AuthIdentity = { readonly uid: string } | null;

export type SubscribeAuthRerunDeps = {
  // Firebase `onAuthStateChanged` bound to the app's auth instance.
  readonly onAuthStateChanged: (
    callback: (user: AuthIdentity) => void,
  ) => () => void;
  // The auth instance's current user, read synchronously.
  readonly readCurrentUid: () => string | null;
  readonly rerun: () => void;
};

// `current`: the resolved identity is the signed-in one; install it.
// `stale`: auth already settled on another identity; rerun for it now.
// `pending`: auth moved on but its notification has not arrived yet; that
// notification reruns, so the caller only stops.
export type AuthBootstrapCheck = "current" | "stale" | "pending";

export type AuthRerunGate = {
  readonly unsubscribe: () => void;
  readonly check: (resolvedUid: string | null) => AuthBootstrapCheck;
};

export function subscribeAuthRerun(deps: SubscribeAuthRerunDeps): AuthRerunGate {
  // Undefined until the first notification; then the last identity observed.
  let observedUid: string | null | undefined = undefined;
  // The identity the latest accepted bootstrap installed.
  let bootstrappedUid: string | null | undefined = undefined;
  const unsubscribe = deps.onAuthStateChanged((user) => {
    const uid = user?.uid ?? null;
    // An older queued notification: auth has already moved on, and the
    // notification for the current identity follows it.
    if (uid !== deps.readCurrentUid()) return;
    const previous = observedUid;
    observedUid = uid;
    if (previous === undefined) {
      // The first notification duplicates the in-flight initial bootstrap,
      // unless a bootstrap already installed a different identity.
      if (bootstrappedUid !== undefined && bootstrappedUid !== uid) deps.rerun();
      return;
    }
    if (uid !== previous) deps.rerun();
  });
  return {
    unsubscribe,
    check: (resolvedUid) => {
      const currentUid = deps.readCurrentUid();
      if (observedUid !== undefined && observedUid !== currentUid) return "pending";
      if (resolvedUid !== currentUid) return "stale";
      bootstrappedUid = resolvedUid;
      return "current";
    },
  };
}
