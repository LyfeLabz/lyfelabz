import { createFirestoreListClasses } from "./classes/listClasses";
import {
  createAuthInput,
  createFirestoreInput,
  getFirebaseAuth,
  getFirebaseFirestore,
  signOut,
} from "./firebase";
import { dispatch } from "./router/router";
import { createRouteTable } from "./router/routes";
import { renderLoadingSurface } from "./router/surfaces";
import { bootstrapSession } from "./session/bootstrap";
import { createBrowserLaunchPresentMode } from "./presentMode/launchContext";

// Client entry point. Waits for the Canonical Session Bootstrap to
// resolve, then hands the resulting immutable Session to the router.
// Whenever authentication state changes (sign-in, sign-out) or a route
// surface calls refreshSession, the entry point re-runs the bootstrap
// and constructs a completely new Session object per Sprint 3 Step 3.

const MOUNT_ID = "app-root";

const findMount = (): HTMLElement => {
  const el = document.getElementById(MOUNT_ID);
  if (el === null) throw new Error(`missing mount node #${MOUNT_ID}`);
  return el;
};

async function run(): Promise<void> {
  const mount = findMount();
  renderLoadingSurface(mount);

  const auth = getFirebaseAuth();
  const db = getFirebaseFirestore();

  let currentRunToken = 0;
  const rerun = async (): Promise<void> => {
    const runToken = ++currentRunToken;
    renderLoadingSurface(mount);
    const session = await bootstrapSession(
      createAuthInput(auth),
      createFirestoreInput(db),
    );
    if (runToken !== currentRunToken) return;
    dispatch(session, table, mount, window.history);
  };

  const onSignIn = async (): Promise<void> => {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } =
      await import("firebase/auth");
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (
        code.includes("popup-blocked") ||
        code.includes("operation-not-supported")
      ) {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw err;
    }
  };

  const onSignOut = (): void => {
    void (async () => {
      try {
        await signOut(auth);
      } finally {
        await rerun();
      }
    })();
  };

  const onRefreshSession = async (): Promise<void> => {
    await rerun();
  };

  const onRequestVerification = async (input: {
    role: "teacher";
    schoolId: string;
    displayName: string;
  }): Promise<void> => {
    const { getFunctions, httpsCallable, connectFunctionsEmulator } =
      await import("firebase/functions");
    const functions = getFunctions();
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")
    ) {
      try {
        connectFunctionsEmulator(functions, "127.0.0.1", 5001);
      } catch {
        // already connected
      }
    }
    const callable = httpsCallable(functions, "teachersRequestVerification");
    await callable(input);
  };

  const listClasses = createFirestoreListClasses(db);
  const onLaunchPresentMode = createBrowserLaunchPresentMode(window);

  const table = createRouteTable({
    onSignOut,
    onSignIn,
    onRefreshSession,
    onRequestVerification,
    listClasses,
    onLaunchPresentMode,
  });

  await rerun();

  const { onAuthStateChanged } = await import("firebase/auth");
  onAuthStateChanged(auth, () => {
    void rerun();
  });
}

void run();
