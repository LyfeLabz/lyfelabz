import { createFirestoreListClasses } from "./classes/listClasses";
import {
  createFirebaseCreateClass,
  type CreateClass,
} from "./classes/createClass";
import {
  createFirebaseLmsCreateClass,
  type LmsCreateClass,
} from "./classes/lmsCreateClass";
import {
  createFirebaseActivateClass,
  type ActivateClass,
} from "./classes/activateClass";
import {
  createFirebaseSyncRoster,
  type SyncRoster,
} from "./classes/syncRoster";
import type { ImportFromClassroomDeps } from "./classes/importFromClassroom";
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
import {
  createAssignmentSummaryCallable,
  createLessonSummaryCallable,
} from "./assignments/summary/wire";
import type {
  AssignmentSummaryCallable,
  LessonSummaryCallable,
} from "./assignments/summary/types";
import { createAssignmentsListForStudentCallable } from "./assignments/studentList/wire";
import type { AssignmentsListForStudentCallable } from "./assignments/studentList/types";
import {
  executeLaunch,
  type LaunchPlan,
  type LaunchExecuteDeps,
} from "./assignments/studentList/launchRouting";
import { createAttemptsListForStudentCallable } from "./assignments/studentResults/wire";
import type { StudentResultsListCallable } from "./assignments/studentResults/types";
import { createDeepLinkResolveCallable } from "./assignments/deepLink/wire";
import type { DeepLinkResolveCallable } from "./assignments/deepLink/types";
import { parseDeepLinkAssignmentId } from "./assignments/deepLink/route";
import { renderDeepLinkArrival } from "./assignments/deepLink/arrival";
import { createAssignmentDetailRegistry } from "./assignments/detail/registry";
import { createAssignmentDetailMetadataReader } from "./assignments/detail/wire";
import { renderAssignmentDetail } from "./assignments/detail/detail";
import { hydrateAssignmentDetailRegistry } from "./assignments/detail/hydrate";
import {
  createDetailLmsRetrySeam,
  clearLmsPublicationRetryContexts,
  clearConnectionReconnectNeeded,
  readConnectionReconnectNeeded,
} from "./shell/surfaces/shared/lmsPublication";
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
  createAssignmentRecipientCandidatesListCallable,
  createAssignmentsRecipientAddCallable,
  type AssignmentRecipientCandidatesListCallable,
  type AssignmentsRecipientAddCallable,
} from "./assignments/detail/late-recipient-wire";
// Sprint 25 certification (B2) fix: drop the Curriculum surface's
// module-scoped teacher class cache on every bootstrap transition so a
// same-uid sign-out/sign-in (auth-session replacement) cannot let the
// Assign dialog reuse the prior session's class rows.
import { invalidateCurriculumClassCache } from "./shell/surfaces/curriculum";
import type {
  TeacherShellOutletController,
  AssignmentDetailOpenOptions,
} from "./shell/surfaces/curriculum";
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

// F5.2 §7.3 (Slice 5): the browser wiring for the launch executor. The routing
// DECISION is server-authoritative and lives in launchRouting.ts; this only
// supplies the three browser side effects it needs. `navigate` is the certified
// full-page assignment launch. `probe` is a same-origin HEAD load-check used
// only for a differentiated artifact before the navigation commits, so an
// unloadable variant (structurally exceptional under §6.8) can fall back
// visually to the standard lesson rather than land the student on a broken page;
// any failure resolves false (fail safe toward canonical). `onVariantLoadFailure`
// emits a NEUTRAL, non-sensitive anomaly (no variantKey, presentationRevisionId,
// launchRef, path, or accommodation detail) - the durable delivery outcome is
// derived server-side (Slice 6), never asserted by the client.
function createBrowserLaunchExecuteDeps(win: Window): LaunchExecuteDeps {
  return {
    navigate: (url: string) => {
      win.location.assign(url);
    },
    probe: async (url: string) => {
      try {
        const res = await win.fetch(url, { method: "HEAD", cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    },
    onVariantLoadFailure: () => {
      try {
        // eslint-disable-next-line no-console
        console.warn(
          "[lyfelabz] lesson presentation unavailable; opening the standard lesson",
        );
      } catch {
        // Observability only.
      }
    },
  };
}

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
  // Sprint 28.6E: lesson-level (cross-assignment) View Summary callable.
  // Wired only for an active-teacher session; null for student/other.
  let lessonSummary: LessonSummaryCallable | null = null;
  // Sprint 17 Slice 4: certified `assignmentsListForStudent` callable
  // seam consumed by the activeStudent surface. Rebound per
  // active-student session so cross-session state cannot leak. Null on
  // any non-student session so the teacher shell never inherits a
  // student-scoped callable.
  let studentAssignmentsList: AssignmentsListForStudentCallable | null = null;
  // Sprint 27 Phase 2 (Decision 1): caller-scoped `assessmentAttemptsList`
  // seam consumed by the activeStudent My Results surface. Rebound per
  // active-student session so cross-session state cannot leak; null on any
  // non-student session so no other surface inherits a student-scoped read.
  let studentResultsList: StudentResultsListCallable | null = null;
  // Sprint 27 Phase 4 (Decision 4): caller-scoped `lmsDeepLinkResolve` seam
  // consumed by the `/app/a/{assignmentId}` arrival surface. Rebound per
  // active-student session so cross-session state cannot leak; null on any
  // non-student session so no other surface inherits a student-scoped
  // resolver.
  let studentDeepLinkResolve: DeepLinkResolveCallable | null = null;
  // Sprint 27 Phase 4: the assignmentId parsed from a Google Classroom
  // deep-link arrival (`/app/a/{assignmentId}`), captured once at startup
  // from the browser location. It is held in memory only (never persisted to
  // storage per PDR-027 §9) and preserved across the sign-in / onboarding
  // round trip through the browser URL, then consumed when the caller
  // resolves to an active student. Null on a normal (non-deep-link) load.
  let pendingDeepLinkAssignmentId: string | null =
    typeof window !== "undefined" && window.location
      ? parseDeepLinkAssignmentId(window.location.pathname)
      : null;
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
  // Sprint 27 Phase 5: late-recipient affordance seams consumed by the
  // Assignment Detail "Students not yet assigned" section. Rebound per
  // active-teacher session so cross-session state cannot leak; null on any
  // non-teacher session so the section never renders.
  let assignmentRecipientCandidatesList: AssignmentRecipientCandidatesListCallable | null =
    null;
  let assignmentRecipientAdd: AssignmentsRecipientAddCallable | null = null;
  // Sprint 15 Slice 6: certified per-attempt detail seam consumed by
  // the per-question factual summary panel above the minimum-attempt
  // threshold. Absent below the threshold; the panel never issues a
  // fetch in that case.
  let attemptGetForTeacher: AttemptGetForTeacherCallable | null = null;
  // Sprint 20 internal beta: certified `classesCreate` callable seam
  // consumed by the Classes surface. Rebound per active-teacher
  // session so cross-session state cannot leak. Null on any non-teacher
  // session so the Classes surface renders read-only.
  let createClass: CreateClass | null = null;
  // Sprint 24B Phase 2B.4: certified `classesLmsCreate` seam. Consumed
  // only by the Google Classroom import orchestrator, never by Manual
  // Create.
  let lmsCreateClass: LmsCreateClass | null = null;
  // Sprint 24B Phase 2B.4: certified `classesActivate` seam. Consumed
  // by the imported-class setup form on the Classes surface. Rebound
  // per active-teacher session so cross-session state cannot leak.
  let activateClass: ActivateClass | null = null;
  // Sprint 24B Phase 2B.8: certified `lmsClassesSyncRoster` seam.
  // Consumed by the LMS class workspace for the automatic initial sync
  // after activation and for the manual "Sync roster" affordance.
  // Rebound per active-teacher session so cross-session state cannot
  // leak. Null on any non-teacher session.
  let syncRoster: SyncRoster | null = null;
  // Sprint 24B Phase 2: primary Import Class from Google Classroom
  // orchestration dependencies. Composed from the certified
  // Integrations callable seam (lmsProvidersList,
  // lmsConnectionsDescribe, lmsConnectionsBegin, lmsConnectionsComplete,
  // lmsClassesDiscover, lmsClassesImport) plus the certified
  // `classesCreate` callable seam. Rebound per active-teacher session
  // so cross-session state cannot leak. Null on any non-teacher
  // session so the Classes surface renders without the primary import
  // entry point.
  let importFromClassroom: ImportFromClassroomDeps | null = null;
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
  // Sprint 28.5D (D2A): the persistent Teacher Workspace shell registers a
  // bounded outlet controller here at mount so Assignment Detail renders
  // inside the shell's content outlet (header, navigation, footer preserved)
  // instead of clearing `#app-root`. Re-registered on every shell mount;
  // null before the shell mounts and on any non-teacher session. When null
  // the opener falls back to the pre-28.5D `#app-root` mount (defensive; in
  // production Detail is only reachable from within a mounted shell).
  let teacherShellOutletController: TeacherShellOutletController | null = null;
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
  const openAssignmentDetail = (
    assignmentId: string,
    options?: AssignmentDetailOpenOptions,
  ): void => {
    if (assignmentSummary === null) return;
    // Capture the narrowed callable so the deferred `renderDetailInto`
    // closure below keeps the non-null type (TS re-widens `assignmentSummary`
    // inside a closure that could run later).
    const summaryCallable = assignmentSummary;
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
    // Sprint 28.5D (D2A): render Assignment Detail into the persistent shell
    // outlet when the shell has registered its controller, so the teacher
    // header and navigation remain mounted (Curriculum stays active) and only
    // the outlet's local content is replaced. `show` clears the outlet and
    // supplies the host. Falls back to clearing `#app-root` (pre-28.5D
    // behavior) only if no shell outlet is registered.
    const renderDetailInto = (target: HTMLElement): void => {
      renderAssignmentDetail(target, {
      assignmentId,
      loadMetadata: createAssignmentDetailMetadataReader(
        assignmentDetailRegistry,
      ),
      summaryCallable: summaryCallable,
      onBack: () => {
        // Sprint 16 Slice 1: happy-path Back re-renders Curriculum
        // against the already-hydrated registry and callable set instead
        // of running a full session bootstrap. Falls back to the full
        // `rerun()` path only when the active-teacher session is
        // unavailable (for example after sign-out).
        //
        // Sprint 28.6C: when Detail was opened from the class-centered
        // workflow (Classes -> Class -> Assignments) the entry point supplies
        // its own `onBack` so the teacher returns to that class context
        // instead of being stranded in Curriculum. The Curriculum path
        // supplies no override and keeps the certified re-mount + scroll
        // restore behavior below.
        if (options?.onBack !== undefined) {
          options.onBack();
          return;
        }
        remountCurriculum();
      },
      backLabel: options?.backLabel,
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
      // Sprint 27 Phase 5: late-recipient affordance. Both seams are wired
      // only for an active-teacher session; the detail surface renders the
      // "Students not yet assigned" section only for a published assignment
      // when both are present. Frozen-recipient semantics are preserved: the
      // add is one-at-a-time, teacher-initiated, and server-mediated.
      recipientCandidatesListCallable:
        assignmentRecipientCandidatesList ?? undefined,
      recipientAddCallable: assignmentRecipientAdd ?? undefined,
      // Sprint 25 Phase 3: publication retry entry point. Built only when
      // the session-scoped store holds a publication that did not succeed
      // for this assignment (recorded by the Assign confirm path). The seam
      // runs the bounded single-consent-then-one-re-issue retry with a
      // fresh nonce and never re-runs the LyfeLabz assignment lifecycle.
      // Absent otherwise, so the pre-Phase-3 detail surface is unchanged.
      lmsRetry:
        lastActiveTeacher !== null
          ? (createDetailLmsRetrySeam({
              uid: lastActiveTeacher.uid,
              assignmentId,
              integrations,
            }) ?? undefined)
          : undefined,
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
    if (teacherShellOutletController !== null) {
      teacherShellOutletController.show(renderDetailInto);
    } else {
      const target = findMount();
      target.textContent = "";
      renderDetailInto(target);
    }
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
    open: (assignmentId: string, options?: AssignmentDetailOpenOptions) => {
      openAssignmentDetail(assignmentId, options);
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
    // Sprint 28.5D (D2A): the Teacher Workspace shell registers its content
    // outlet controller here at mount so the Assignment Detail opener renders
    // Detail inside the persistent shell rather than clearing `#app-root`.
    // Registered on every shell mount; the slot is dropped on every bootstrap
    // transition so a stale, detached outlet cannot be reused.
    setOutletController: (controller: TeacherShellOutletController | null) => {
      teacherShellOutletController = controller;
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
        // Sprint 26 Phase 4: bind the session-local reconnect signal to this
        // teacher so Settings renders "action needed" only for a condition
        // LyfeLabz actually observed this session (definition §7.F).
        connectionRecovery: {
          needsReconnect: (providerId) =>
            readConnectionReconnectNeeded(session.uid, providerId),
          clear: (providerId) =>
            clearConnectionReconnectNeeded(session.uid, providerId),
        },
      });
      assignments = createAssignmentsCallables(functions);
      assignmentSummary = createAssignmentSummaryCallable(functions);
      lessonSummary = createLessonSummaryCallable(functions);
      assignmentClose = createAssignmentsCloseCallable(functions);
      assignmentReopen = createAssignmentsReopenCallable(functions);
      assignmentUpdateDraft = createAssignmentsUpdateDraftCallable(functions);
      assignmentPublish = createAssignmentsPublishCallable(functions);
      assignmentRecipientList = createAssignmentRecipientListCallable(functions);
      assignmentRecipientCandidatesList =
        createAssignmentRecipientCandidatesListCallable(functions);
      assignmentRecipientAdd = createAssignmentsRecipientAddCallable(functions);
      attemptsListForClass = createAttemptsListForClassCallable(functions);
      attemptGetForTeacher = createAttemptGetForTeacherCallable(functions);
      createClass = createFirebaseCreateClass(functions);
      lmsCreateClass = createFirebaseLmsCreateClass(functions);
      activateClass = createFirebaseActivateClass(functions);
      syncRoster = createFirebaseSyncRoster(functions);
      if (runToken !== currentRunToken) return;
      importFromClassroom = Object.freeze({
        callables: integrations.callables,
        openOAuth: integrations.openOAuth,
        redirectUri: integrations.redirectUri,
        lmsCreateClass,
        listTeacherClasses: integrations.listTeacherClasses,
        listClassLinks: integrations.listClassLinks ?? null,
      });
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
      studentAssignmentsList = null;
      studentResultsList = null;
      studentDeepLinkResolve = null;
    } else if (session.kind === "activeStudent") {
      // Sprint 17 Slice 4: certified student-scoped callable seam. This
      // branch never touches the teacher-only callables, never hydrates
      // the teacher assignment-detail registry, and never runs a
      // teacher-shell code path. Firebase Functions is initialized here
      // exactly the same way the teacher branch initializes it so the
      // emulator override behaves identically in local development.
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
      studentAssignmentsList =
        createAssignmentsListForStudentCallable(functions);
      studentResultsList = createAttemptsListForStudentCallable(functions);
      studentDeepLinkResolve = createDeepLinkResolveCallable(functions);
      integrations = null;
      assignments = null;
      assignmentSummary = null;
      lessonSummary = null;
      assignmentClose = null;
      assignmentReopen = null;
      assignmentUpdateDraft = null;
      assignmentPublish = null;
      assignmentRecipientList = null;
      assignmentRecipientCandidatesList = null;
      assignmentRecipientAdd = null;
      attemptsListForClass = null;
      attemptGetForTeacher = null;
      createClass = null;
      lmsCreateClass = null;
      activateClass = null;
      syncRoster = null;
      importFromClassroom = null;
      assignmentDetailRegistry.clear();
      clearLmsPublicationRetryContexts();
      lastActiveTeacher = null;
    } else {
      integrations = null;
      assignments = null;
      assignmentSummary = null;
      lessonSummary = null;
      assignmentClose = null;
      assignmentReopen = null;
      assignmentUpdateDraft = null;
      assignmentPublish = null;
      assignmentRecipientList = null;
      assignmentRecipientCandidatesList = null;
      assignmentRecipientAdd = null;
      attemptsListForClass = null;
      attemptGetForTeacher = null;
      createClass = null;
      lmsCreateClass = null;
      activateClass = null;
      syncRoster = null;
      importFromClassroom = null;
      assignmentDetailRegistry.clear();
      clearLmsPublicationRetryContexts();
      lastActiveTeacher = null;
      studentAssignmentsList = null;
      studentResultsList = null;
      studentDeepLinkResolve = null;
    }
    activeAssignmentsInvalidator = null;
    // Sprint 28.5D (D2A): drop the shell outlet controller on every bootstrap
    // transition, mirroring the invalidator above. A teacher shell re-registers
    // its controller when it mounts later in this same dispatch; a non-teacher
    // session leaves it null so no stale, detached outlet can be reused.
    teacherShellOutletController = null;
    // Sprint 16 Slice 4: any bootstrap transition (sign-out, teacher
    // swap, or a full auth-driven `rerun`) invalidates the pending
    // Curriculum scroll snapshot so no offset can restore against an
    // unrelated surface or teacher context.
    curriculumScrollGuard.invalidate();
    // Sprint 25 (B2): the same bootstrap boundary drops the Curriculum
    // class cache. Sign-out/sign-in as the same teacher keeps the uid, so
    // the uid-keyed cache would otherwise survive the teardown and feed
    // the Assign dialog stale rows. In-tab surface navigation does not
    // pass through `rerun`, so the intended within-session prefetch cache
    // is preserved; only a real auth transition clears it.
    invalidateCurriculumClassCache();

    // Sprint 27 Phase 4: Google Classroom deep-link arrival handoff. When a
    // pending `/app/a/{assignmentId}` arrival is present, route by session
    // kind (blueprint §8.3):
    //   - active student: invoke the read-only resolver and hand off to the
    //     existing runtime or a calm state. The resolver is the authorization
    //     boundary; the normal My Assignments / My Results dispatch is skipped.
    //   - provisioned / unauthenticated: render onboarding / sign-in WITHOUT
    //     replacing the URL, so the `/app/a/{assignmentId}` location is
    //     preserved across a redirect sign-in round trip (browser history is
    //     the only permitted preservation mechanism, PDR-027 §9). The pending
    //     id is kept so activation / sign-in re-resolves it. No token or PII
    //     is ever stored in the return destination.
    //   - any other kind (teacher, administrator, suspended, archived,
    //     error): the deep link is student-only. Clear it and render normally.
    if (pendingDeepLinkAssignmentId !== null) {
      if (
        session.kind === "activeStudent" &&
        studentDeepLinkResolve !== null
      ) {
        const arrivalAssignmentId = pendingDeepLinkAssignmentId;
        const resolve = studentDeepLinkResolve;
        pendingDeepLinkAssignmentId = null;
        const launchDeps = createBrowserLaunchExecuteDeps(window);
        void renderDeepLinkArrival(mount, {
          assignmentId: arrivalAssignmentId,
          resolve: (input) => resolve(input),
          // F5.2 §7.3 (Slice 5): route through the shared launch executor so a
          // differentiated deep-link launch is load-probed with the same
          // canonical fallback behavior as the My Science launcher.
          navigate: launchDeps.navigate,
          probe: launchDeps.probe,
          onVariantLoadFailure: launchDeps.onVariantLoadFailure,
          onGoToMyAssignments: () => {
            dispatch(session, table, mount, window.history);
          },
        });
        return;
      }
      if (
        session.kind === "provisioned" ||
        session.kind === "unauthenticated"
      ) {
        // Render without a history update so the deep-link URL survives the
        // auth / onboarding round trip. The pending id is intentionally kept.
        dispatch(session, table, mount);
        return;
      }
      // Student-only link on a non-student session: discard it.
      pendingDeepLinkAssignmentId = null;
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

  // Sprint 29G.5C: direct allowlisted pilot-teacher activation. No name,
  // school, or email is sent; the server reads the authenticated email,
  // checks the protected pilot allowlist, assigns the canonical pilot
  // school, and activates the teacher. After a successful call the ID token
  // is force-refreshed so the newly issued teacher custom claims (role,
  // schoolId, districtId) are present before the teacher workspace loads,
  // mirroring the student onboarding path.
  const onActivatePilotTeacher = async (): Promise<void> => {
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
    const activate = httpsCallable(functions, "teachersActivatePilot");
    await activate({ role: "teacher" });
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.getIdToken(true);
    }
  };

  // Sprint 20 internal beta: canonical school id for the beta cohort.
  // The class join code alone does not carry a schoolId, but the beta is
  // scoped to a single school. Mirrors platform/functions/src/scripts/
  // bootstrap-beta-teacher.ts (BETA_SCHOOL_ID). When the beta expands to
  // multiple schools this constant will be replaced by a school selector
  // or a join-code-scoped resolution callable.
  const BETA_SCHOOL_ID = "school-beta";

  const onStudentOnboarding = async (input: {
    displayName: string;
    joinCode: string;
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
    const complete = httpsCallable(functions, "studentsCompleteOnboarding");
    await complete({
      role: "student",
      schoolId: BETA_SCHOOL_ID,
      displayName: input.displayName,
    });
    // Force an ID token refresh so the newly issued custom claims
    // (role: "student", schoolId, districtId) are present before the
    // enrollment callable runs. Without this, requireDistrictContext in
    // enrollmentsJoinByCode would reject the call as claim-stale.
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.getIdToken(true);
    }
    const join = httpsCallable(functions, "enrollmentsJoinByCode");
    await join({ joinCode: input.joinCode });
  };

  // Sprint 27 Phase 3 (Decision 2): LMS-rostered student activation. Unlike
  // the manual path, no join code and no schoolId are sent. The server
  // derives school and district from the authoritative LMS enrollment the
  // teacher's roster sync established; the client asserts nothing about
  // roster, class, school, district, or Google identity. The optional
  // display name is the only value carried. After activation, the ID token
  // is force-refreshed so the newly issued custom claims (role: "student",
  // schoolId, districtId) are present before the active-student surface
  // loads.
  const onStudentLmsOnboarding = async (input: {
    displayName?: string;
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
    const complete = httpsCallable(functions, "studentsCompleteLmsOnboarding");
    await complete(
      input.displayName !== undefined && input.displayName.length > 0
        ? { displayName: input.displayName }
        : {},
    );
    // Force an ID token refresh so the newly issued custom claims are
    // present before the active-student surface issues any
    // district-scoped read. This mirrors the manual onboarding path.
    const currentUser = auth.currentUser;
    if (currentUser) {
      await currentUser.getIdToken(true);
    }
  };

  const getGoogleDisplayName = (): string | null => {
    const u = auth.currentUser;
    if (!u) return null;
    return typeof u.displayName === "string" && u.displayName.length > 0
      ? u.displayName
      : null;
  };

  const table = createRouteTable({
    onSignOut,
    onSignIn,
    onRefreshSession,
    onRequestVerification,
    onActivatePilotTeacher,
    onStudentOnboarding,
    onStudentLmsOnboarding,
    getGoogleDisplayName,
    listClasses,
    onLaunchPresentMode,
    integrations: () => integrations,
    assignments: () => assignments,
    assignmentDetail: () => assignmentDetailSeam,
    assignmentSummary: () => assignmentSummary,
    lessonSummary: () => lessonSummary,
    studentAssignmentsList: () => studentAssignmentsList,
    studentResultsList: () => studentResultsList,
    createClass: () => createClass,
    importFromClassroom: () => importFromClassroom,
    activateClass: () => activateClass,
    syncRoster: () => syncRoster,
    refreshRoster: () => integrations?.callables.refreshRoster ?? null,
    onLaunchAssignment: (plan: LaunchPlan) => {
      // F5.2 §7.3 (Slice 5): execute the server-authoritative launch plan.
      // Canonical/canonicalFallback plans navigate directly; a differentiated
      // plan is load-probed and, on failure, falls back visually to the standard
      // lesson (launchRef discarded). The runtime detects assignment context and
      // transports the launchRef on lesson load; this launcher only routes.
      void executeLaunch(plan, createBrowserLaunchExecuteDeps(window));
    },
  });

  await rerun();

  const { onAuthStateChanged } = await import("firebase/auth");
  onAuthStateChanged(auth, () => {
    void rerun();
  });
}

void run();
