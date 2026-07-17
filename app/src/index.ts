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
import { hydrateAssignmentDetailRegistry } from "./assignments/detail/hydrate";
import { createAssignmentsTeacherListCallable } from "./assignments/detail/hydrate-wire";
import { createAssignmentsCloseCallable } from "./assignments/detail/close-wire";
import { createAssignmentsReopenCallable } from "./assignments/detail/reopen-wire";
import type {
  AssignmentsCloseCallable,
  AssignmentsReopenCallable,
} from "./assignments/detail/types";

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
  // Sprint 13D: certified `assignmentsClose` callable seam consumed by
  // the Assignment Detail surface. Rebound per active-teacher session so
  // cross-session state cannot leak. Null before an active-teacher
  // session resolves; the detail surface renders no close action when
  // null.
  let assignmentClose: AssignmentsCloseCallable | null = null;
  // Sprint 13E: certified `assignmentsReopen` callable seam consumed by
  // the Assignment Detail surface. Rebound per active-teacher session so
  // cross-session state cannot leak. Null before an active-teacher
  // session resolves; the detail surface renders no reopen action when
  // null.
  let assignmentReopen: AssignmentsReopenCallable | null = null;
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
      // Sprint 13D: wire the certified close callable and register the
      // updated metadata into the session-scoped registry so a later
      // navigation to Curriculum reflects the new `closed` status
      // through the existing Sprint 13C selection interface without a
      // page reload.
      closeCallable: assignmentClose ?? undefined,
      // Sprint 13E: inverse lifecycle wire. The certified reopen
      // callable transitions a closed assignment back to published and
      // re-registers the updated metadata into the session-scoped
      // registry so a later navigation to Curriculum reflects the new
      // `published` status through the existing Sprint 13C selection
      // interface without a page reload.
      reopenCallable: assignmentReopen ?? undefined,
      onStatusChange: (metadata) => {
        assignmentDetailRegistry.register(metadata);
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
    // Sprint 13C: expose the current registry contents so the Curriculum
    // surface can restore its per-lesson mapping after a full page
    // reload. Returns only teacher-owned metadata (title, className,
    // status, lessonSlug, classId); never student, recipient, attempt,
    // or session identifiers.
    list: () => assignmentDetailRegistry.list(),
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
      assignmentClose = createAssignmentsCloseCallable(functions);
      assignmentReopen = createAssignmentsReopenCallable(functions);
      // Sprint 13C: hydrate the session-scoped assignment-detail registry
      // from the certified `assignmentsTeacherList` retrieval path. The
      // hydration runs once per active-teacher session and is calm on
      // failure so a callable outage never blocks the workspace. Newly
      // published assignments in the current session still register
      // through the Sprint 13B publish path; deduplication is by canonical
      // assignmentId inside the registry.
      const teacherList = createAssignmentsTeacherListCallable(functions);
      await hydrateAssignmentDetailRegistry(
        assignmentDetailRegistry,
        teacherList,
      );
      if (runToken !== currentRunToken) return;
    } else {
      integrations = null;
      assignments = null;
      assignmentSummary = null;
      assignmentClose = null;
      assignmentReopen = null;
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
