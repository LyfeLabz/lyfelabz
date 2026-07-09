import {
  createAuthInput,
  createFirestoreInput,
  getFirebaseAuth,
  getFirebaseFirestore,
  signOut,
} from "./firebase";
import { dispatch } from "./router/router";
import { createRouteTable } from "./router/routes";
import { bootstrapSession } from "./session/bootstrap";

// Client entry point. Waits for the Canonical Session Bootstrap to
// resolve, then hands the resulting immutable Session to the router.
// Whenever authentication state changes (sign-in, sign-out), the entry
// point re-runs the bootstrap and constructs a completely new Session
// object per Sprint 3 Step 3 refinement.

const MOUNT_ID = "app-root";
const LOADING_TEXT = "Loading LyfeLabz Platform";

const findMount = (): HTMLElement => {
  const el = document.getElementById(MOUNT_ID);
  if (el === null) throw new Error(`missing mount node #${MOUNT_ID}`);
  return el;
};

const renderLoading = (mount: HTMLElement): void => {
  while (mount.firstChild) mount.removeChild(mount.firstChild);
  const p = document.createElement("p");
  p.setAttribute("role", "status");
  p.textContent = LOADING_TEXT;
  mount.appendChild(p);
};

async function run(): Promise<void> {
  const mount = findMount();
  renderLoading(mount);

  const auth = getFirebaseAuth();
  const db = getFirebaseFirestore();

  const table = createRouteTable(() => {
    // Fire-and-forget: signOut triggers onAuthStateChanged, which the
    // re-run below reacts to on the next iteration.
    void signOut(auth);
  });

  // Re-run the bootstrap on every auth-state change so the Session
  // object is always freshly constructed and immutable.
  //
  // The bootstrap itself waits for the first onAuthStateChanged tick.
  // We additionally hook onAuthStateChanged so that later transitions
  // (sign-in from the sign-in surface, sign-out from any authenticated
  // surface) also produce a new Session.
  let currentRunToken = 0;
  const rerun = async (): Promise<void> => {
    const runToken = ++currentRunToken;
    renderLoading(mount);
    const session = await bootstrapSession(createAuthInput(auth), createFirestoreInput(db));
    // Guard against out-of-order resolutions.
    if (runToken !== currentRunToken) return;
    dispatch(session, table, mount, window.history);
  };

  await rerun();

  // Native Firebase listener: subscribe *after* the initial bootstrap so
  // the first tick does not re-enter rerun before the initial render.
  const { onAuthStateChanged } = await import("firebase/auth");
  onAuthStateChanged(auth, () => {
    void rerun();
  });
}

// The entry point is invoked immediately. Errors are surfaced via the
// error Session kind by the bootstrap, so run() should never reject.
void run();
