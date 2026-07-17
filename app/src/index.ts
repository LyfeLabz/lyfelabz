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
import {
  createAssignmentsCallables,
  createIntegrationsDeps,
} from "./settings/integrations/wire";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
} from "./settings/integrations/types";
import { createAssignmentSummaryCallable } from "./assignments/summary/wire";
import type { AssignmentSummaryCallable } from "./assignments/summary/types";
import { createAssignmentDetailRegistry } from "./assignments/detail/registry";
import { createAssignmentDetailMetadataReader } from "./assignments/detail/wire";
import { renderAssignmentDetail } from "./assignments/detail/detail";

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

  const listClasses = createFirestoreListClasses(db);
  const onLaunchPresentMode = createBrowserLaunchPresentMode(window);

  let currentRunToken = 0;
  let integrations: IntegrationsDeps | null = null;
  let assignments: AssignmentsCallables | null = null;
  // Sprint 13A: certified `assessmentAssignmentSummary` callable seam
  // consumed by the reusable Assignment Summary card. Rebound per
  // active-teacher session so cross-session state cannot leak.
  let assignmentSummary: AssignmentSummaryCallable | null = null;
  // Sprint 13B: session-scoped registry of teacher-owned assignment
  // metadata (title, status, class name). Populated by the certified
  // lifecycle path; consumed by the Assignment Detail metadata reader.
  // Rebuilt per active-teacher session so cross-session state cannot
  // leak.
  const assignmentDetailRegistry = createAssignmentDetailRegistry();
  const openAssignmentDetail = (assignmentId: string): void => {
    if (assignmentSummary === null) return;
    const target = findMount();
    target.textContent = "";
    renderAssignmentDetail(target, {
      assignmentId,
      loadMetadata: createAssignmentDetailMetadataReader(
        assignmentDetailRegistry,
      ),
      summaryCallable: assignmentSummary,
      onBack: () => {
        void rerun();
      },
    });
  };
  // Sprint 13B remediation. Stable per-tab seam consumed by the
  // Curriculum surface. `register` records teacher-owned metadata into
  // the session-scoped registry after a successful publish; `open`
  // invokes the entry-point Assignment Detail opener. The seam is
  // stable across reruns; the underlying registry is cleared on any
  // non-teacher bootstrap outcome, so `open` is a safe no-op after
  // sign-out (the registry lookup returns null and the detail surface
  // renders its empty state).
  const assignmentDetailSeam = Object.freeze({
    register: (metadata: Parameters<typeof assignmentDetailRegistry.register>[0]) => {
      assignmentDetailRegistry.register(metadata);
    },
    open: (assignmentId: string) => {
      openAssignmentDetail(assignmentId);
    },
  });
  const rerun = async (): Promise<void> => {
    const runToken = ++currentRunToken;
    renderLoadingSurface(mount);
    const session = await bootstrapSession(
      createAuthInput(auth),
      createFirestoreInput(db),
    );
    if (runToken !== currentRunToken) return;
    if (session.kind === "activeTeacher") {
      const { getFunctions, connectFunctionsEmulator } = await import(
        "firebase/functions"
      );
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
      integrations = createIntegrationsDeps({
        functions,
        listClasses,
        teacherUid: session.uid,
        win: window,
        db,
      });
      assignments = createAssignmentsCallables(functions);
      assignmentSummary = createAssignmentSummaryCallable(functions);
    } else {
      integrations = null;
      assignments = null;
      assignmentSummary = null;
      assignmentDetailRegistry.clear();
    }
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

  const table = createRouteTable({
    onSignOut,
    onSignIn,
    onRefreshSession,
    onRequestVerification,
    listClasses,
    onLaunchPresentMode,
    integrations: () => integrations,
    assignments: () => assignments,
    assignmentDetail: () => assignmentDetailSeam,
  });

  await rerun();

  const { onAuthStateChanged } = await import("firebase/auth");
  onAuthStateChanged(auth, () => {
    void rerun();
  });
}

void run();
