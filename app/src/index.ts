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
import { createCurriculumScrollGuard } from "./shell/curriculumScrollGuard";
import { bootstrapSession } from "./session/bootstrap";
import type { Session } from "./session/types";
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
import { createAssignmentsUpdateDraftCallable } from "./assignments/detail/update-wire";
import { createAssignmentsPublishCallable } from "./assignments/detail/publish-wire";
import {
  createAssignmentRecipientListCallable,
  type AssignmentRecipientListCallable,
} from "./assignments/detail/roster-wire";
import {
  createAttemptGetForTeacherCallable,
  createAttemptsListForClassCallable,
  type AttemptGetForTeacherCallable,
  type AttemptsListForClassCallable,
} from "./assignments/detail/attempts-wire";
import type {
  AssignmentsCloseCallable,
  AssignmentsPublishCallable,
  AssignmentsReopenCallable,
  AssignmentsUpdateDraftCallable,
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
  // Sprint 13G: certified `assignmentsUpdateDraft` callable seam consumed
  // by the Assignment Detail surface's inline draft editor. Rebound per
  // active-teacher session so cross-session state cannot leak. Null
  // before an active-teacher session resolves; the detail surface renders
  // no edit action when null.
  let assignmentUpdateDraft: AssignmentsUpdateDraftCallable | null = null;
  // Sprint 13H: certified `assignmentsPublish` callable seam consumed by
  // the Assignment Detail surface's Draft publication action. Rebound per
  // active-teacher session so cross-session state cannot leak. Null
  // before an active-teacher session resolves; the detail surface renders
  // no publish action when null.
  let assignmentPublish: AssignmentsPublishCallable | null = null;
  // Sprint 15 Slice 5: certified recipient enumeration + completed
  // attempts list consumed by the Assignment Detail roster grouping.
  let assignmentRecipientList: AssignmentRecipientListCallable | null = null;
  let attemptsListForClass: AttemptsListForClassCallable | null = null;
  // Sprint 15 Slice 6: certified per-attempt detail seam consumed by
  // the per-question factual summary panel above the minimum-attempt
  // threshold. Absent below the threshold; the panel never issues a
  // fetch in that case.
  let attemptGetForTeacher: AttemptGetForTeacherCallable | null = null;
  // Sprint 13B: session-scoped registry of teacher-owned assignment
  // metadata (title, status, class name). Populated by the certified
  // lifecycle path; consumed by the Assignment Detail metadata reader.
  // Rebuilt per active-teacher session so cross-session state cannot
  // leak.
  const assignmentDetailRegistry = createAssignmentDetailRegistry();
  // Sprint 16 Slice 1: hoisted references used by the lighter Back path
  // from Assignment Detail. `lastActiveTeacher` records the most-recent
  // successful active-teacher session (set at the end of `rerun` on the
  // activeTeacher branch, cleared on any other branch); `remountCurriculum`
  // re-renders the Curriculum surface against the already-hydrated
  // registry and callable set without repeating auth, Functions,
  // integrations, or `assignmentsTeacherList` hydration. When an
  // active-teacher session is unavailable, the Back handler falls back to
  // the full `rerun()` path.
  let lastActiveTeacher: Extract<Session, { kind: "activeTeacher" }> | null =
    null;
  // Sprint 16 Slice 1: per-assignment invalidator installed by the
  // Curriculum surface on mount and cleared before Assignment Detail
  // mounts, so a lifecycle change routed through `onStatusChange` while
  // Curriculum is the active surface refreshes the affected dashboard
  // card. When Curriculum is not mounted, the invalidator is null and
  // `onStatusChange` only re-registers the registry; the next Curriculum
  // mount reads the fresh registry as today.
  let activeAssignmentsInvalidator: ((assignmentId: string) => void) | null =
    null;
  // Sprint 16 Slice 4: session-scoped Curriculum scroll guard. The
  // guard captures the current Curriculum scroll offset when the
  // teacher opens Assignment Detail and restores it (clamped to the
  // current document height) on the return trip through the Detail
  // Back control. It is invalidated by every bootstrap transition
  // (sign-out, teacher swap, full `rerun`) so a stale offset can never
  // restore against an unrelated surface.
  const curriculumScrollGuard = createCurriculumScrollGuard({
    getMaxScrollY: () =>
      document.documentElement.scrollHeight - window.innerHeight,
    scrollTo: (y) => {
      window.scrollTo(0, y);
    },
  });
  const remountCurriculum = (): void => {
    const session = lastActiveTeacher;
    if (session === null) {
      void rerun();
      return;
    }
    activeAssignmentsInvalidator = null;
    dispatch(session, table, mount, window.history);
    const doRestore = (): void => {
      curriculumScrollGuard.restore(session.uid);
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(doRestore);
    } else {
      doRestore();
    }
  };
  const openAssignmentDetail = (assignmentId: string): void => {
    if (assignmentSummary === null) return;
    // Sprint 16 Slice 4: snapshot the current Curriculum scroll offset
    // so the return trip through the lighter Back path can restore the
    // teacher near their prior position. Scoped to the active teacher
    // uid so a sign-out or teacher swap invalidates the snapshot.
    if (lastActiveTeacher !== null) {
      curriculumScrollGuard.capture(lastActiveTeacher.uid, window.scrollY);
    }
    // Clear the Curriculum-owned invalidator before we replace the mount
    // so a lifecycle change fired during this Detail surface's lifetime
    // cannot invoke a stale handler bound to a detached section.
    activeAssignmentsInvalidator = null;
    const target = findMount();
    target.textContent = "";
    renderAssignmentDetail(target, {
      assignmentId,
      loadMetadata: createAssignmentDetailMetadataReader(
        assignmentDetailRegistry,
      ),
      summaryCallable: assignmentSummary,
      onBack: () => {
        // Sprint 16 Slice 1: happy-path Back re-renders Curriculum
        // against the already-hydrated registry and callable set instead
        // of running a full session bootstrap. Falls back to the full
        // `rerun()` path only when the active-teacher session is
        // unavailable (for example after sign-out).
        remountCurriculum();
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
      // Sprint 13G: draft-editing wire. The certified update-draft
      // callable narrowly updates draft metadata (title). On success the
      // updated metadata is re-registered into the session-scoped
      // registry so a later navigation to Curriculum reflects the new
      // draft title through the Sprint 13C/13F selection interface
      // without a page reload.
      updateDraftCallable: assignmentUpdateDraft ?? undefined,
      // Sprint 13H: draft-publication wire. The certified publish
      // callable advances a draft to `published`. On success the updated
      // metadata is re-registered into the session-scoped registry so a
      // later navigation to Curriculum reflects the new `published`
      // status through the Sprint 13C/13F selection interface (`View
      // drafts` becomes `View summary` / `View summaries`) without a
      // page reload.
      publishCallable: assignmentPublish ?? undefined,
      recipientListCallable: assignmentRecipientList ?? undefined,
      attemptsListForClassCallable: attemptsListForClass ?? undefined,
      attemptGetForTeacherCallable: attemptGetForTeacher ?? undefined,
      onStatusChange: (metadata) => {
        assignmentDetailRegistry.register(metadata);
        // Sprint 16 Slice 1: when Curriculum owns the mount, refresh the
        // affected dashboard card. The invalidator is null while any
        // non-Curriculum surface (including Assignment Detail) is
        // mounted, so this side effect is quiet until Curriculum
        // remounts and re-installs its handler.
        activeAssignmentsInvalidator?.(metadata.assignmentId);
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
    // Sprint 16 Slice 1: Curriculum installs a per-assignment
    // invalidator on mount and clears it on unmount. The entry point
    // holds the mutable slot so a lifecycle status change routed
    // through `onStatusChange` can refresh the affected dashboard card
    // without teaching the detail surface about the dashboard.
    setActiveAssignmentsInvalidator: (
      invalidator: ((assignmentId: string) => void) | null,
    ) => {
      activeAssignmentsInvalidator = invalidator;
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
      assignmentClose = createAssignmentsCloseCallable(functions);
      assignmentReopen = createAssignmentsReopenCallable(functions);
      assignmentUpdateDraft = createAssignmentsUpdateDraftCallable(functions);
      assignmentPublish = createAssignmentsPublishCallable(functions);
      assignmentRecipientList = createAssignmentRecipientListCallable(functions);
      attemptsListForClass = createAttemptsListForClassCallable(functions);
      attemptGetForTeacher = createAttemptGetForTeacherCallable(functions);
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
      lastActiveTeacher = session;
    } else {
      integrations = null;
      assignments = null;
      assignmentSummary = null;
      assignmentClose = null;
      assignmentReopen = null;
      assignmentUpdateDraft = null;
      assignmentPublish = null;
      assignmentRecipientList = null;
      attemptsListForClass = null;
      attemptGetForTeacher = null;
      assignmentDetailRegistry.clear();
      lastActiveTeacher = null;
    }
    activeAssignmentsInvalidator = null;
    // Sprint 16 Slice 4: any bootstrap transition (sign-out, teacher
    // swap, or a full auth-driven `rerun`) invalidates the pending
    // Curriculum scroll snapshot so no offset can restore against an
    // unrelated surface or teacher context.
    curriculumScrollGuard.invalidate();
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
    assignmentSummary: () => assignmentSummary,
  });

  await rerun();

  const { onAuthStateChanged } = await import("firebase/auth");
  onAuthStateChanged(auth, () => {
    void rerun();
  });
}

void run();
