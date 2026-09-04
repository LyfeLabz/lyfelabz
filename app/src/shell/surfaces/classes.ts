import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { CreateClass, CreateClassResult } from "../../classes/createClass";
import type { ActivateClass } from "../../classes/activateClass";
import type {
  SyncRoster,
  SyncRosterCounters,
  SyncRosterError,
} from "../../classes/syncRoster";
import type {
  ImportController,
  ImportFromClassroomDeps,
  ImportState,
} from "../../classes/importFromClassroom";
import { createImportFromClassroom } from "../../classes/importFromClassroom";
import type { IntegrationsLmsClass } from "../../settings/integrations/types";
import type { TeacherDefaultGrade } from "../../teacherPreferences/types";
import { isTeacherDefaultGrade } from "../../teacherPreferences/types";
// Sprint 28.6H.3 (Task B1): Overview/Snapshot is removed from the class
// workspace, so `renderSnapshotSurface` is no longer mounted here. The
// `SnapshotPreview` type is retained on the deps contract (dormant) so the
// shell wiring stays intact; the surface module itself is left dormant in the
// tree (not deleted), mirroring the Present Mode disposition.
import type { SnapshotPreview } from "./snapshot";
// Sprint 25 certification (B2) fix: after any class mutation on this
// surface, drop the Curriculum surface's module-scoped class cache so
// the Assign dialog cannot keep serving the pre-mutation class list. The
// two sibling surfaces already flow through the shared shell; this direct
// import mirrors the existing sibling import of `./snapshot`.
import { invalidateCurriculumClassCache } from "./curriculum";
import type {
  CurriculumAssignmentDetailSeam,
  AssignmentDetailOpenOptions,
} from "./curriculum";
import type { WorkspaceSurfaceKey } from "../navigation";
// Sprint 28.6C: the class-scoped Assignments section reuses the certified
// Active Assignments renderer (flat, filtered by classId) rather than
// duplicating an assignment-row implementation. Curriculum keeps mounting the
// same renderer in its accordion form until 28.6D removes it from Curriculum.
import {
  renderActiveAssignmentsSection,
  isRenderableCard,
} from "./shared/activeAssignments";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type { AssignmentSummaryCallable } from "../../assignments/summary/types";

// Classroom Workspace surface. Renders read-only classroom cards for
// the authenticated teacher. See SPRINT_6B_SPECIFICATION.md §6.
//
// Sprint 7B introduces the class workspace inside the certified
// `classes` workspace surface. When a teacher opens a specific class,
// the class workspace mounts and opens on Snapshot by default per
// CLASS_SNAPSHOT_EXPERIENCE.md §6 and SNAPSHOT_ARCHITECTURE.md §6.
// The class-level surface remains available one level deeper through
// a subordinate class-level navigation. The permanent four-item
// Teacher Workspace navigation is unchanged.
//
// This module opens no Firestore listener, invokes no callable, and
// imports no firebase/* module. It receives its data through the
// injected `listClasses` fetcher wired at the client entry point. The
// shell "no firebase imports" invariant established by Sprint 3 Step 5
// (spec §6.6, §11.2) is preserved.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

// Phase 2B.4: `setup` is the workspace state for a needsSetup class.
// It is not a peer of Snapshot / Roster in the class navigation; it
// replaces both until the class becomes active. Snapshot and Roster
// are unreachable for a needsSetup class.
//
// Sprint 28.6C: the class workspace becomes the conceptual Overview /
// Assignments / Students structure. The internal tab keys are kept stable
// (`snapshot` = Overview, `roster` = Students) so the certified switcher
// testids and their tests are preserved; `assignments` is the new
// class-scoped operational section. Only the visible labels change.
export type ClassWorkspaceTab =
  | "snapshot"
  | "assignments"
  | "roster"
  | "setup";

// Sprint 28.6C: shell-owned return location so the teacher lands back in a
// class's Assignments section after returning from Assignment Detail. See
// shell.ts `classesReturn`.
export type ClassWorkspaceReturn = {
  readonly classId: string;
  readonly tab: ClassWorkspaceTab;
};

// Sprint 28.6F: which class-management control the Classes surface should
// open on its next mount. Settings' "Classes & Google Classroom" section
// sets this (via the shell opener) and navigates to Classes, so the two
// entry points drive one workflow implementation. `"create"` opens the
// Create LyfeLabz Class form; `"import"` reveals and focuses the Import
// entry point (the teacher confirms with one click so the OAuth pop-up
// stays inside a user gesture). Consumed exactly once per navigation.
export type ClassManagementIntent = "create" | "import";

// Sprint 28.6C: class-assignment wiring shared by the class card (count) and
// the class workspace Assignments section. `enabled` is false in harnesses
// with no assignment seam, in which case counts read 0 and the Assignments
// section shows its calm empty state.
type ClassAssignmentsView = {
  readonly enabled: boolean;
  readonly count: (classId: string) => number;
  readonly listRegistry: () => ReadonlyArray<AssignmentDetailMetadata>;
  readonly open: (classId: string, assignmentId: string) => void;
  readonly summaryCallable: AssignmentSummaryCallable | null;
  readonly onGoToCurriculum: (() => void) | null;
};

// Optional snapshot preview data. When null (production default), the
// Snapshot surface renders the certified no-data state. When present,
// the static representative preview is rendered instead. Preview data
// is implementation-local, never persisted, and never sourced from
// Firestore or Cloud Functions. See snapshot.ts.
export type ClassesSurfaceDeps = {
  readonly listClasses: ListClasses;
  readonly snapshotPreview?: SnapshotPreview | null;
  // Sprint 20 internal beta: injected create-class callable seam. When
  // null the surface renders read-only (legacy Sprint 6B behavior).
  // When present, the class list exposes a Create Class control that
  // invokes the certified `classesCreate` callable and reveals the
  // server-generated join code.
  readonly createClass?: CreateClass | null;
  // Sprint 24B Phase 2: injected dependencies for the primary Import
  // Class from Google Classroom flow. When null the primary control is
  // hidden (the secondary Create LyfeLabz Class entry point still
  // renders). Per SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md §4.2, no new
  // orchestration callable is introduced; this seam bundles the
  // certified callables already wired at the entry point.
  readonly importFromClassroom?: ImportFromClassroomDeps | null;
  // Sprint 24B Phase 2B.4: certified `classesActivate` seam consumed
  // by the imported-class setup form. Null when not wired (test
  // harnesses that do not exercise activation); in that case the setup
  // form still renders but its submit is disabled and the teacher is
  // told to try again in a moment.
  readonly activateClass?: ActivateClass | null;
  // Sprint 24B Phase 2B.8: certified `lmsClassesSyncRoster` seam
  // consumed by the LMS class workspace. The Classes surface uses this
  // seam for two teacher-facing paths:
  //
  //   1. Automatic initial sync fired immediately after a successful
  //      `classesActivate` on an LMS-sourced class. A sync failure at
  //      this stage NEVER unwinds activation and NEVER shows an
  //      activation-failed message. Activation succeeded independently.
  //
  //   2. Manual "Sync roster" action rendered in the class workspace
  //      only for active LMS-linked classes. Duplicate concurrent clicks
  //      are suppressed by the in-flight flag.
  //
  // Null when the callable is not wired (test harnesses that do not
  // exercise roster sync); in that case the button is not rendered and
  // the automatic initial sync is skipped without altering activation
  // behavior.
  readonly syncRoster?: SyncRoster | null;
  // Sprint 29G.5K-3: best-effort membership freshness callable. When wired,
  // the surface fires `lmsClassesRefreshRoster` once per class-open event for
  // LMS-backed classes so newly added Classroom students are captured without
  // a teacher action. Fire-and-forget: a refresh failure never blocks class
  // use; the last-known-good membership state remains authoritative.
  readonly refreshRoster?:
    | ((input: { readonly classId: string }) => Promise<unknown>)
    | null;
  // Sprint 28.6C: the session-scoped teacher assignment-detail seam (the same
  // one Curriculum uses). The Classes surface reads `list()` - already
  // hydrated once from `assignmentsTeacherList`, which carries `classId` - to
  // group per-class assignment counts and to render each class's Assignments
  // section, and calls `open()` to reach the existing Assignment Detail. It
  // never enumerates classes, never fans out per class, and adds no callable.
  // Null in harnesses that do not exercise assignments.
  readonly assignmentDetail?: CurriculumAssignmentDetailSeam | null;
  // Sprint 28.6C: certified `assessmentAssignmentSummary` seam passed through
  // to the class Assignments section for the same per-card progress line
  // Curriculum shows. Optional; when null no progress line is rendered.
  readonly assignmentSummary?: AssignmentSummaryCallable | null;
  // Sprint 28.6C: bounded intra-shell navigation seam. Used to route the empty
  // Assignments state to Curriculum and to return to Classes after Assignment
  // Detail. Null in harnesses that do not exercise those paths.
  readonly navigateToSurface?: ((surface: WorkspaceSurfaceKey) => void) | null;
  // Sprint 28.6C: shell-owned class-workspace return-location seam (see
  // shell.ts). Read once on mount to re-land in the class Assignments section
  // after Assignment Detail; written just before opening Detail.
  readonly getClassesReturn?: (() => ClassWorkspaceReturn | null) | null;
  readonly setClassesReturn?:
    | ((loc: ClassWorkspaceReturn | null) => void)
    | null;
  // Sprint 28.6F: class-management intent one-shot (see shell.ts). Read once
  // on mount so a Settings "Import" / "Create" choice opens the matching
  // control here (the SAME workflow the `+ Add a class` entry uses); cleared
  // immediately after consumption. Absent in harnesses that do not exercise it.
  readonly getClassManagementIntent?:
    | (() => ClassManagementIntent | null)
    | null;
  readonly setClassManagementIntent?:
    | ((intent: ClassManagementIntent | null) => void)
    | null;
};

// Sprint 28.6H (Finding 2): the class-card status label map was removed with
// the Active badge (see renderClassCard). Snapshot/Overview keeps its own
// status labelling where meaningful; the everyday class card no longer repeats
// the class status. Backend class-status semantics are unchanged.

type CreateFormState = {
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly submitting: boolean;
  readonly error: string | null;
};

// Setup form state for the imported-class workspace. Grade and block both
// begin empty; the teacher chooses them for this class before activation
// (Sprint 28.6F removed the teacher-level grade seed, Blueprint §14).
type SetupFormState = {
  readonly grade: string;
  readonly block: string;
  readonly submitting: boolean;
  readonly error: string | null;
};

type ClassesState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "list";
      readonly classes: ReadonlyArray<ClassSummary>;
      readonly form: CreateFormState | null;
      readonly lastCreated: CreateClassResult | null;
      readonly importState: ImportState;
    }
  | {
      readonly kind: "workspace";
      readonly classes: ReadonlyArray<ClassSummary>;
      readonly selectedId: string;
      readonly tab: ClassWorkspaceTab;
      readonly setupForm: SetupFormState | null;
    };

// Grade/block always begin empty; the teacher must choose explicitly for
// every class. Sprint 28.6F removed the global teacher `defaultGrade`
// preference that previously seeded these (Blueprint §14): a class derives
// its grade only from its own create/setup flow, never from a teacher-level
// default. There is no `defaultBlock` at any layer (ADR §12).
const emptyForm = (): CreateFormState =>
  Object.freeze({
    title: "",
    grade: "",
    block: "",
    submitting: false,
    error: null,
  });

const emptySetupForm = (): SetupFormState =>
  Object.freeze({
    grade: "",
    block: "",
    submitting: false,
    error: null,
  });

export function renderClassesSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: ClassesSurfaceDeps,
): void {
  const doc = mount.ownerDocument;
  // Sprint 28.6H.3 (Task B1): `deps.snapshotPreview` is dormant (Overview
  // removed); it is intentionally not read here anymore.
  const createClass = deps.createClass ?? null;
  const importDeps = deps.importFromClassroom ?? null;
  const activateClass = deps.activateClass ?? null;
  const syncRoster = deps.syncRoster ?? null;
  const refreshRoster = deps.refreshRoster ?? null;
  const assignmentDetail = deps.assignmentDetail ?? null;
  const assignmentSummary = deps.assignmentSummary ?? null;
  const navigateToSurface = deps.navigateToSurface ?? null;
  const getClassesReturn = deps.getClassesReturn ?? null;
  const setClassesReturn = deps.setClassesReturn ?? null;
  const getClassManagementIntent = deps.getClassManagementIntent ?? null;
  const setClassManagementIntent = deps.setClassManagementIntent ?? null;

  // Sprint 28.6C: the whole-teacher assignment registry, already hydrated once
  // from `assignmentsTeacherList` (which carries `classId`). Reading it is a
  // pure in-memory grouping - never a per-class call, never an N+1 read.
  const listAllAssignments = (): ReadonlyArray<AssignmentDetailMetadata> =>
    assignmentDetail?.list?.() ?? [];

  // Sprint 28.6C: the count shown on a class card is exactly the set of
  // assignments reachable through that class's Assignments section - published
  // and closed (drafts are never surfaced). Same predicate the class
  // Assignments section applies, so the card count and the section can never
  // disagree, and another class's assignments can never inflate it.
  const countClassAssignments = (classId: string): number => {
    let n = 0;
    for (const meta of listAllAssignments()) {
      if (meta.classId === classId && isRenderableCard(meta)) n += 1;
    }
    return n;
  };

  // Sprint 28.6C: open the existing Assignment Detail from the class-centered
  // workflow. Records the return location on the shell so the Back control (and
  // returning nav) re-lands in this class's Assignments section rather than
  // stranding the teacher in Curriculum; supplies a "Back to class" label. When
  // the seam is absent (harness) the row action is simply inert.
  const openClassAssignment = (classId: string, assignmentId: string): void => {
    if (assignmentDetail === null) return;
    setClassesReturn?.({ classId, tab: "assignments" });
    const options: AssignmentDetailOpenOptions = {
      backLabel: "Back to class",
      onBack: () => {
        navigateToSurface?.("classes");
      },
    };
    assignmentDetail.open(assignmentId, options);
  };

  // Sprint 28.6C: the single bundle of class-assignment wiring threaded to the
  // class card (count) and the class workspace (Assignments section). Grouping
  // it keeps the two renderers' signatures from growing per field.
  const assignmentsView: ClassAssignmentsView = {
    enabled: assignmentDetail !== null,
    count: countClassAssignments,
    listRegistry: listAllAssignments,
    open: openClassAssignment,
    summaryCallable: assignmentSummary,
    onGoToCurriculum:
      navigateToSurface !== null ? () => navigateToSurface("curriculum") : null,
  };

  // Sprint 24B Phase 2B.8. Per-class roster-sync UI state. Ephemeral to
  // this surface mount; not persisted to Firestore. Keyed by classId.
  // Distinct from the class-lifecycle state machine so a roster-sync
  // failure never corrupts the workspace state model.
  //
  // Duplicate-request protection: an in-flight request sets status to
  // "syncing" for that classId. Any second automatic or manual trigger
  // for the same class checks the map and refuses to issue a second
  // request while one is in flight.
  type RosterSyncEntry =
    | { readonly status: "idle" }
    | { readonly status: "syncing" }
    | { readonly status: "ok"; readonly counters: SyncRosterCounters; readonly at: number }
    | {
        readonly status: "error";
        readonly kind: SyncRosterError["kind"];
        readonly at: number;
      };
  const rosterSyncByClass: Map<string, RosterSyncEntry> = new Map();

  // Sprint 29G.5K-3: tracks class-open membership refreshes currently in
  // flight so a rapid re-open of the same class does not double-call.
  // Membership is removed on completion (success or failure) so a later
  // genuine re-open can trigger another refresh.
  const rosterRefreshInFlight: Set<string> = new Set();

  // Sprint 28.6H (Finding 1): whether the minimized "+ Add class" disclosure is
  // revealed in a populated Classes list. Closure-scoped (not part of the
  // discriminated state) so it survives every list-state reconstruction the
  // import/create flow performs; the discriminated state rebuilds would
  // otherwise drop it and snap the panel shut mid-workflow. Ignored in the
  // zero-class state, where the Import / Create workflow is always prominent.
  // Sprint 28.6H.6 (Part F/G): which class-source TASK the teacher chose, so the
  // routed task surface shows ONLY that task (create form OR Google Classroom
  // import), never the alternative path. Set from the one-shot Settings intent
  // and from an in-surface Create/Import choice; cleared when a task is
  // cancelled. `null` means the (zero-class) decision surface, which offers both.
  let listAddMode: ClassManagementIntent | null = null;

  const getRosterSyncEntry = (classId: string): RosterSyncEntry =>
    rosterSyncByClass.get(classId) ?? { status: "idle" };

  const isSyncInFlight = (classId: string): boolean =>
    getRosterSyncEntry(classId).status === "syncing";

  // Sprint 28.6H.3 (Task B3/C4): the automatic post-activation roster sync for
  // a newly-activated LMS-linked class is preserved (backend behavior
  // unchanged). Its manual counterpart and status panel moved to Settings →
  // Class Management; the class workspace no longer renders roster-sync UI.
  const runRosterSync = (classId: string): void => {
    if (syncRoster === null) return;
    if (isSyncInFlight(classId)) return;
    rosterSyncByClass.set(classId, { status: "syncing" });
    rerender();
    void syncRoster({ classId })
      .then((result) => {
        if (!mount.isConnected) return;
        const counters: SyncRosterCounters = {
          added: result.added,
          reactivated: result.reactivated,
          unchanged: result.unchanged,
          withdrawn: result.withdrawn,
          unresolved: result.unresolved,
          skipped: result.skipped,
          upstreamRosterEmpty: result.upstreamRosterEmpty,
        };
        rosterSyncByClass.set(classId, {
          status: "ok",
          counters,
          at: Date.now(),
        });
        rerender();
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        // syncRoster wrapper always throws a SyncRosterError; if
        // something else reaches this catch, coerce to "unknown".
        const kind: SyncRosterError["kind"] =
          err && typeof err === "object" && "kind" in err &&
          typeof (err as { kind?: unknown }).kind === "string"
            ? ((err as { kind: SyncRosterError["kind"] }).kind)
            : "unknown";
        rosterSyncByClass.set(classId, {
          status: "error",
          kind,
          at: Date.now(),
        });
        rerender();
      });
  };

  let state: ClassesState = { kind: "loading" };
  let importController: ImportController | null = null;

  const rerender = (): void => {
    if (!mount.isConnected) return;
    mount.textContent = "";
    const s: ClassesState = state;
    switch (s.kind) {
      case "loading":
        renderLoading(doc, mount);
        return;
      case "error":
        renderErrorState(doc, mount);
        return;
      case "list":
        renderListState(
          doc,
          mount,
          s.classes,
          onOpenClass,
          s.form,
          s.lastCreated,
          onStartCreate,
          onCancelCreate,
          onFormChange,
          onSubmitCreate,
          onDismissLastCreated,
          importDeps !== null && createClass !== null,
          s.importState,
          onStartImport,
          onSelectImportCourse,
          onCancelImport,
          onRetryImport,
          onOpenClass,
          listAddMode,
          navigateToSurface !== null
            ? () => navigateToSurface("settings")
            : null,
        );
        return;
      case "workspace": {
        const summary = s.classes.find((c) => c.id === s.selectedId);
        if (!summary) {
          state = {
            kind: "list",
            classes: s.classes,
            form: null,
            lastCreated: null,
            importState: idleImportState(),
          };
          rerender();
          return;
        }
        renderClassWorkspaceState(
          doc,
          mount,
          summary,
          s.tab,
          onSelectTab,
          onBackToList,
          s.setupForm,
          onSetupFormChange,
          onSubmitSetup,
          onCancelSetup,
          activateClass !== null,
          assignmentsView,
        );
        return;
      }
    }
  };

  const idleImportState = (): ImportState =>
    Object.freeze({ kind: "idle" as const });

  const onOpenClass = (classId: string): void => {
    if (state.kind !== "list") return;
    // Opening a class leaves any focused class-source task.
    listAddMode = null;
    const summary = state.classes.find((c) => c.id === classId);
    // Phase 2B.4: a needsSetup class opens directly on the setup form.
    // Assignments and Students are unreachable until activation completes.
    const isNeedsSetup = summary?.status === "needsSetup";
    // Sprint 28.6H.3 (Task B2): an active class opens directly on Assignments
    // ("what is happening with my students" is the everyday question), not the
    // removed Overview. Overview/Snapshot is no longer a reachable tab.
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: classId,
      tab: isNeedsSetup ? "setup" : "assignments",
      setupForm: isNeedsSetup ? emptySetupForm() : null,
    };
    rerender();
    // Sprint 29G.5K-3: best-effort membership freshness on class open.
    // Fires only for active LMS-backed classes (needsSetup classes have no
    // enrolled students yet and do not need a refresh). Never blocks the
    // class from opening; a failure is logged for engineering diagnosis but
    // does not surface to the teacher or alter the class workspace.
    if (
      refreshRoster !== null &&
      summary?.isLmsLinked === true &&
      summary.status === "active" &&
      !rosterRefreshInFlight.has(classId)
    ) {
      rosterRefreshInFlight.add(classId);
      void refreshRoster({ classId })
        .catch((err: unknown) => {
          // Best-effort: class remains open with last-known-good membership.
          if (typeof console !== "undefined") {
            console.warn("[LyfeLabz] class-open roster refresh failed:", err);
          }
        })
        .finally(() => {
          rosterRefreshInFlight.delete(classId);
        });
    }
  };

  const onStartCreate = (): void => {
    if (state.kind !== "list") return;
    // Sprint 28.6H.6 (Part F): entering the focused manual-create task.
    listAddMode = "create";
    state = {
      kind: "list",
      classes: state.classes,
      form: emptyForm(),
      lastCreated: null,
      importState: state.importState,
    };
    rerender();
  };

  const onCancelCreate = (): void => {
    if (state.kind !== "list") return;
    // Sprint 28.6H.6 (Part F5): Cancel returns to the Settings -> Class
    // Management decision surface (the administrative home for choosing a class
    // source) when the surface-navigation seam is wired; the create draft is
    // cleared either way. Without the seam (some harnesses) it falls back to the
    // in-Classes decision state.
    listAddMode = null;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: state.lastCreated,
      importState: state.importState,
    };
    if (navigateToSurface !== null) {
      navigateToSurface("settings");
      return;
    }
    rerender();
  };

  const onFormChange = (patch: Partial<CreateFormState>): void => {
    if (state.kind !== "list" || state.form === null) return;
    state = {
      kind: "list",
      classes: state.classes,
      form: Object.freeze({ ...state.form, ...patch }),
      lastCreated: state.lastCreated,
      importState: state.importState,
    };
    // No rerender. The input/select DOM already reflects the user's
    // keystroke or selection; rebuilding the surface here would replace
    // the active control, steal focus back to the Classes headline, and
    // scroll the page. Rerenders happen on submit, cancel, validation
    // error, and async responses, all of which read from state.form.
  };

  const onDismissLastCreated = (): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: state.form,
      lastCreated: null,
      importState: state.importState,
    };
    rerender();
  };

  const updateImportState = (next: ImportState): void => {
    if (next.kind === "linked") {
      // Sprint 25 (B2): the import created a new class server-side.
      // Invalidate the Curriculum class cache unconditionally (before the
      // surface-state guard) so a later Assign open re-fetches and can
      // see the imported class.
      invalidateCurriculumClassCache();
    }
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: state.form,
      lastCreated: state.lastCreated,
      importState: next,
    };
    rerender();
    if (next.kind === "linked") {
      // Sprint 28.6H.8: the import succeeded - leave the focused import task so
      // a later return to the list shows the operational landing, not the task.
      listAddMode = null;
      const targetClassId = next.classId;
      // Phase 2B.4: the linked class is a `needsSetup` class. Refresh
      // the list so the new row is present, then open the workspace
      // directly on the setup form. Snapshot / Roster remain
      // unreachable until activation completes.
      void deps
        .listClasses(session.uid)
        .then((classes) => {
          if (!mount.isConnected) return;
          if (state.kind !== "list") return;
          state = {
            kind: "workspace",
            classes,
            selectedId: targetClassId,
            tab: "setup",
            setupForm: emptySetupForm(),
          };
          rerender();
        })
        .catch(() => {
          if (!mount.isConnected) return;
          if (state.kind !== "list") return;
          // Best-effort: if the refresh fails the teacher can still
          // finish setup from the Classes list on the next visit
          // through the Finish setup affordance.
        });
    }
  };

  const ensureImportController = (): ImportController | null => {
    if (importDeps === null || createClass === null) return null;
    if (importController !== null) return importController;
    importController = createImportFromClassroom(importDeps, (next) =>
      updateImportState(next),
    );
    return importController;
  };

  const onStartImport = (): void => {
    const controller = ensureImportController();
    if (controller === null) return;
    // Sprint 28.6H.6 (Part G): entering the focused Google Classroom import task.
    listAddMode = "import";
    void controller.start();
  };

  const onSelectImportCourse = (course: IntegrationsLmsClass): void => {
    if (importController === null) return;
    void importController.selectCourse(course);
  };

  const onCancelImport = (): void => {
    // Sprint 28.6H.6 (Part G): leaving the focused import task returns to the
    // Settings -> Class Management decision surface (symmetric with create).
    // The in-flight import controller is still aborted first so no OAuth/import
    // work is left running; existing import semantics are unchanged.
    listAddMode = null;
    if (importController !== null) {
      importController.cancel();
    } else if (state.kind === "list") {
      state = {
        kind: "list",
        classes: state.classes,
        form: state.form,
        lastCreated: state.lastCreated,
        importState: idleImportState(),
      };
    }
    if (navigateToSurface !== null) {
      navigateToSurface("settings");
      return;
    }
    rerender();
  };

  const onRetryImport = (): void => {
    if (importController === null) return;
    void importController.retry();
  };

  const currentImportState = (): ImportState =>
    state.kind === "list" ? state.importState : idleImportState();

  const onSubmitCreate = (): void => {
    if (state.kind !== "list" || state.form === null) return;
    if (createClass === null) return;
    const form = state.form;
    const title = form.title.trim();
    const grade = form.grade.trim();
    const block = form.block.trim().toUpperCase();
    if (title.length === 0) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({ ...form, error: "Enter a class name." }),
        lastCreated: state.lastCreated,
        importState: state.importState,
      };
      rerender();
      return;
    }
    // Phase 2B.4: require explicit grade selection. Grade "" (no
    // selection) rejects; only 6/7/8 pass. This retires the pre-Phase
    // 2B.4 hard-coded fallback to Grade 7 that Manual Create silently
    // applied when no preference existed.
    if (!isTeacherDefaultGrade(grade)) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({
          ...form,
          error: "Choose a grade for this class.",
        }),
        lastCreated: state.lastCreated,
        importState: state.importState,
      };
      rerender();
      return;
    }
    if (!/^[A-G]$/.test(block)) {
      state = {
        kind: "list",
        classes: state.classes,
        form: Object.freeze({
          ...form,
          error: "Choose a class block (A through G).",
        }),
        lastCreated: state.lastCreated,
        importState: state.importState,
      };
      rerender();
      return;
    }
    state = {
      kind: "list",
      classes: state.classes,
      form: Object.freeze({ ...form, submitting: true, error: null }),
      lastCreated: state.lastCreated,
      importState: state.importState,
    };
    rerender();
    void createClass({ title, grade, block })
      .then((result) => {
        // Sprint 25 (B2): a class was created server-side. Invalidate the
        // Curriculum class cache before the mount-connection guard so a
        // later Assign open re-fetches and can see it even if the teacher
        // has already navigated away from the Classes surface.
        invalidateCurriculumClassCache();
        if (!mount.isConnected) return;
        // Sprint 28.6H.8: the create succeeded - leave the focused create task
        // so the operational landing (with the new class + its join code)
        // renders, not the task surface.
        listAddMode = null;
        void deps
          .listClasses(session.uid)
          .then((classes) => {
            if (!mount.isConnected) return;
            state = {
              kind: "list",
              classes,
              form: null,
              lastCreated: result,
              importState: currentImportState(),
            };
            rerender();
          })
          .catch(() => {
            if (!mount.isConnected) return;
            state = {
              kind: "list",
              classes:
                state.kind === "list" ? state.classes : ([] as ReadonlyArray<ClassSummary>),
              form: null,
              lastCreated: result,
              importState: currentImportState(),
            };
            rerender();
          });
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        if (state.kind !== "list") return;
        const message = describeCreateError(err);
        state = {
          kind: "list",
          classes: state.classes,
          form: Object.freeze({ ...form, submitting: false, error: message }),
          lastCreated: state.lastCreated,
          importState: state.importState,
        };
        rerender();
      });
  };

  const onSelectTab = (tab: ClassWorkspaceTab): void => {
    if (state.kind !== "workspace") return;
    if (state.tab === tab) return;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab,
      setupForm: tab === "setup" ? (state.setupForm ?? emptySetupForm()) : null,
    };
    rerender();
  };

  const onBackToList = (): void => {
    if (state.kind !== "workspace") return;
    // Returning to the operational Classes landing leaves any class-source task.
    listAddMode = null;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: null,
      importState: idleImportState(),
    };
    rerender();
  };

  const onSetupFormChange = (patch: Partial<SetupFormState>): void => {
    if (state.kind !== "workspace" || state.setupForm === null) return;
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: state.selectedId,
      tab: state.tab,
      setupForm: Object.freeze({ ...state.setupForm, ...patch }),
    };
    // No rerender. Native select controls already reflect the change.
  };

  const onCancelSetup = (): void => {
    if (state.kind !== "workspace") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: null,
      importState: idleImportState(),
    };
    rerender();
  };

  const onSubmitSetup = (): void => {
    const current = state;
    if (current.kind !== "workspace" || current.setupForm === null) return;
    if (activateClass === null) return;
    const setupForm = current.setupForm;
    const summary = current.classes.find((c) => c.id === current.selectedId);
    if (!summary || summary.status !== "needsSetup") return;
    const grade = setupForm.grade;
    const block = setupForm.block.toUpperCase();
    if (!isTeacherDefaultGrade(grade)) {
      state = {
        kind: "workspace",
        classes: current.classes,
        selectedId: current.selectedId,
        tab: current.tab,
        setupForm: Object.freeze({
          ...setupForm,
          error: "Choose a grade before you finish setup.",
        }),
      };
      rerender();
      return;
    }
    if (!/^[A-G]$/.test(block)) {
      state = {
        kind: "workspace",
        classes: current.classes,
        selectedId: current.selectedId,
        tab: current.tab,
        setupForm: Object.freeze({
          ...setupForm,
          error: "Choose a class block before you finish setup.",
        }),
      };
      rerender();
      return;
    }
    state = {
      kind: "workspace",
      classes: current.classes,
      selectedId: current.selectedId,
      tab: current.tab,
      setupForm: Object.freeze({
        ...setupForm,
        submitting: true,
        error: null,
      }),
    };
    rerender();
    const classId = current.selectedId;
    const submittedGrade: TeacherDefaultGrade = grade;
    const submittedBlock = block as "A" | "B" | "C" | "D" | "E" | "F" | "G";
    void activateClass({
      classId,
      grade: submittedGrade,
      block: submittedBlock,
    })
      .then(() => {
        // Sprint 25 (B2): activation moved a `needsSetup` class to
        // `active` (the only status the Assign dialog surfaces).
        // Invalidate the Curriculum class cache before the mount guard so
        // a later Assign open re-fetches the now-active class.
        invalidateCurriculumClassCache();
        if (!mount.isConnected) return;
        // Refresh the class list so the newly active class carries its
        // atomic grade / block / joinCode, then land on the class default.
        // Sprint 28.6H.3 (Task B1/B2): Overview/Snapshot is removed, so a
        // just-activated class opens directly on Assignments like every other
        // active class.
        void deps
          .listClasses(session.uid)
          .then((classes) => {
            if (!mount.isConnected) return;
            state = {
              kind: "workspace",
              classes,
              selectedId: classId,
              tab: "assignments",
              setupForm: null,
            };
            // Sprint 24B Phase 2B.8. Automatic initial roster sync for
            // an LMS-linked class. Fires strictly AFTER activation
            // resolves, uses the refreshed class list to confirm
            // isLmsLinked and active, and is a no-op for manual classes.
            // The activation .then() has already run to completion;
            // a sync failure at this point NEVER downgrades the
            // activation-success narrative (see rerender + workspace
            // renderer, which surface roster-sync state separately).
            const refreshed = classes.find((c) => c.id === classId);
            if (
              refreshed !== undefined &&
              refreshed.status === "active" &&
              refreshed.isLmsLinked === true
            ) {
              runRosterSync(classId);
            }
            rerender();
          })
          .catch(() => {
            if (!mount.isConnected) return;
            // Best-effort: if the refresh fails, fall back to the list
            // so the teacher can reopen the (now active) class.
            const s2 = state;
            state = {
              kind: "list",
              classes:
                s2.kind === "workspace" || s2.kind === "list"
                  ? s2.classes
                  : ([] as ReadonlyArray<ClassSummary>),
              form: null,
              lastCreated: null,
              importState: idleImportState(),
            };
            rerender();
          });
      })
      .catch((err: unknown) => {
        if (!mount.isConnected) return;
        const s3 = state;
        if (s3.kind !== "workspace") return;
        const message = describeActivationError(err);
        state = {
          kind: "workspace",
          classes: s3.classes,
          selectedId: s3.selectedId,
          tab: s3.tab,
          setupForm: Object.freeze({
            ...setupForm,
            submitting: false,
            error: message,
          }),
        };
        rerender();
      });
  };

  rerender();

  void deps
    .listClasses(session.uid)
    .then((classes) => {
      if (!mount.isConnected) return;
      // Sprint 28.6C: one-shot return-context restore. When the teacher just
      // came back from Assignment Detail opened inside a class, re-land in that
      // class's recorded section (Assignments) instead of the class list. The
      // location is consumed exactly once; any later Classes visit shows the
      // list. Only active classes restore into the workspace; a class that has
      // since been removed or reverted to needsSetup falls back to the list.
      const restore = getClassesReturn?.() ?? null;
      if (restore !== null) {
        setClassesReturn?.(null);
        const target = classes.find(
          (c) => c.id === restore.classId && c.status === "active",
        );
        if (target !== undefined) {
          state = {
            kind: "workspace",
            classes,
            selectedId: restore.classId,
            // Sprint 28.6H.3 (Task B1/B2): Overview/Snapshot is removed; any
            // stale restore target (setup or the retired snapshot) re-lands on
            // Assignments, the class default.
            tab:
              restore.tab === "assignments" || restore.tab === "roster"
                ? restore.tab
                : "assignments",
            setupForm: null,
          };
          rerender();
          return;
        }
      }
      // Sprint 28.6F: one-shot class-management intent. When the teacher chose
      // Import / Create from Settings' "Classes & Google Classroom" section,
      // the shell recorded the intent and routed here; open the matching
      // control in the SAME `+ Add a class` workflow. Consumed exactly once;
      // any later Classes visit shows the plain list. Only honored when the
      // corresponding workflow is actually wired (createClass / import).
      const intent = getClassManagementIntent?.() ?? null;
      if (intent !== null) setClassManagementIntent?.(null);
      const openCreate = intent === "create" && createClass !== null;
      // Sprint 28.6H (Finding 1): an incoming class-management intent also
      // reveals the minimized Add-a-class disclosure so the shared workflow is
      // visible on a populated list (it is always visible when zero classes).
      const openImport =
        intent === "import" && importDeps !== null && createClass !== null;
      // Sprint 28.6H.6 (Part F/G): a routed intent selects the focused task so
      // the alternative path is not shown alongside it.
      listAddMode = openCreate ? "create" : openImport ? "import" : null;
      state = {
        kind: "list",
        classes,
        form: openCreate ? emptyForm() : null,
        lastCreated: null,
        importState: idleImportState(),
      };
      rerender();
      focusForClassManagementIntent(intent);
      // Sprint 28.6H.8 (Part D/D1): a routed Import intent launches the focused
      // Google Classroom import task DIRECTLY - the teacher does not click a
      // second Import button. `onStartImport()` runs the certified import
      // controller (Part D2: contextual authorization - discovery when already
      // authorized, the existing OAuth flow when not). It is invoked here,
      // ~1 await after the Settings "Import Class" click that drove this
      // navigation, so the OAuth pop-up (`win.open`, a few fast awaits later)
      // stays inside the click's transient activation window (Part O); the
      // certified popup-blocked path + retry remains the fallback. No new OAuth
      // is introduced.
      if (openImport) onStartImport();
    })
    .catch(() => {
      if (!mount.isConnected) return;
      state = { kind: "error" };
      rerender();
    });

  // Sprint 28.6F: after the list (with any intent-opened control) has
  // rendered, move focus into the shared workflow so a Settings entry lands
  // the teacher exactly where the action is. Create focuses the class-name
  // input; Import focuses the Import entry point (the teacher confirms with
  // one click, keeping the OAuth pop-up inside a user gesture). Scrolls the
  // control into view when the environment supports it.
  function focusForClassManagementIntent(
    intent: ClassManagementIntent | null,
  ): void {
    if (intent === null) return;
    if (!mount.isConnected) return;
    const testId =
      intent === "create" && createClass !== null
        ? "classes-create-title"
        : intent === "import" && importDeps !== null && createClass !== null
          ? "classes-import-open"
          : null;
    if (testId === null) return;
    const target = mount.querySelector<HTMLElement>(
      `[data-testid=${testId}]`,
    );
    if (target === null) return;
    try {
      target.scrollIntoView({ block: "center" });
    } catch {
      // Non-DOM-complete environments (jsdom) may not implement scrollIntoView.
    }
    try {
      target.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  }
}

// Phase 2B.4: teacher-facing mapping for the classesActivate error
// taxonomy. Raw callable codes never surface to the teacher.
function describeActivationError(err: unknown): string {
  const code = extractErrorCode(err);
  if (code.includes("notFound") || code.includes("not-found")) {
    return "This class no longer exists. Return to Classes and try again.";
  }
  if (code.includes("forbidden") || code.includes("permission")) {
    return "You do not have permission to finish setting up this class.";
  }
  if (code.includes("notActivatable")) {
    return "This class can no longer be finished. It may have been archived.";
  }
  if (code.includes("alreadyActiveConflict")) {
    return "This class is already set up. Open it from Classes to change the grade or block.";
  }
  if (code.includes("joinCodeGenerationFailed")) {
    return "We could not finish setting up. Try again in a moment.";
  }
  if (code.includes("invalidGrade") || code.includes("invalidBlock")) {
    return "Choose a valid grade and block, then try again.";
  }
  if (code.includes("unauthenticated") || code.includes("claim-stale")) {
    return "Your session has expired. Reload the page and sign in again.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  return "We could not finish setting up this class. Try again in a moment.";
}

function extractErrorCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const details = (err as { details?: unknown }).details;
  if (details && typeof details === "object" && "code" in details) {
    const dc = (details as { code?: unknown }).code;
    if (typeof dc === "string") return dc;
  }
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" ? c : "";
}

function describeCreateError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message)
      : "";
  if (code.includes("permission") || code.includes("forbidden")) {
    return "Your account is not permitted to create classes yet.";
  }
  if (code.includes("unauthenticated")) {
    return "Your session has expired. Reload the page and sign in again.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz. Check your connection and try again.";
  }
  if (message) return message.slice(0, 240);
  return "We could not create the class. Try again in a moment.";
}

function renderLoading(doc: Document, mount: HTMLElement): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Loading classes";
  mount.appendChild(status);

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);
}

function renderErrorState(doc: Document, mount: HTMLElement): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "We could not load your classes.";
  mount.appendChild(status);

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  const retry = doc.createElement("p");
  retry.className = "shell-classes-error";
  retry.setAttribute("data-testid", "classes-error");
  retry.textContent =
    "Reload the page to try again. If the problem continues, contact support.";
  region.appendChild(retry);
  mount.appendChild(region);
}

function renderListState(
  doc: Document,
  mount: HTMLElement,
  classes: ReadonlyArray<ClassSummary>,
  onOpen: (classId: string) => void,
  form: CreateFormState | null,
  lastCreated: CreateClassResult | null,
  onStartCreate: () => void,
  onCancelCreate: () => void,
  onFormChange: (patch: Partial<CreateFormState>) => void,
  onSubmitCreate: () => void,
  onDismissLastCreated: () => void,
  canImport: boolean,
  importState: ImportState,
  onStartImport: () => void,
  onSelectImportCourse: (course: IntegrationsLmsClass) => void,
  onCancelImport: () => void,
  onRetryImport: () => void,
  onOpenExistingClass: (classId: string) => void,
  // Sprint 28.6H.6/H.8 (Part D/E): the chosen class-source task. "create" /
  // "import" render ONLY that focused task; null renders the operational
  // Classes landing (no class-administration controls).
  addMode: ClassManagementIntent | null,
  // Sprint 28.6H.8 (Part C2): navigate to Settings -> Class Management from the
  // zero-class Classes landing (the operational landing no longer hosts any
  // class-administration control). Null in harnesses without the seam.
  onGoToSettings: (() => void) | null,
): void {
  const hasClasses = classes.length > 0;

  // Sprint 28.6H.6 (Part F/G): the class-management workflow is DECISION vs
  // TASK separated. A chosen task (manual create OR Google Classroom import)
  // renders ONLY that task - never the alternative path and never an "Add a
  // class" wrapper heading. The decision state (no task chosen, e.g. the
  // zero-class landing) presents the two class sources as clearly distinct
  // labelled groups (Google Classroom / LyfeLabz Classes). The underlying
  // Import / Create implementations are unchanged and still shared with
  // Settings.
  const importEntry = (directLaunch = false): HTMLElement =>
    renderImportEntryPoint(
      doc,
      canImport,
      importState,
      onStartImport,
      onSelectImportCourse,
      onCancelImport,
      onRetryImport,
      onOpenExistingClass,
      directLaunch,
    );
  const createControls = (): HTMLElement =>
    renderCreateControls(
      doc,
      form,
      onStartCreate,
      onCancelCreate,
      onFormChange,
      onSubmitCreate,
    );

  const buildAddSection = (): HTMLElement => {
    const addGroup = doc.createElement("section");
    addGroup.className = "shell-classes-add";
    addGroup.id = "classes-add-panel";
    addGroup.setAttribute("data-testid", "classes-add-a-class");
    addGroup.setAttribute("role", "region");

    // FOCUSED MANUAL CREATE TASK (Part F): only the manual form. No "Add a
    // class" wrapper (F1), no Google Classroom import action (F2). The form
    // carries its own "Create LyfeLabz Class" heading and a "Create Class"
    // submit (F3/F4).
    if (form !== null) {
      addGroup.setAttribute("aria-label", "Create LyfeLabz Class");
      addGroup.appendChild(createControls());
      return addGroup;
    }

    // FOCUSED GOOGLE CLASSROOM IMPORT TASK (Part D/E/G): only the import
    // workflow, launched DIRECTLY (auto-started). `directLaunch` suppresses the
    // standalone "Import Class from Google Classroom" button (Task D3 - no
    // second Import click) and shows the authorization / discovery progression;
    // the manual Create form/action is never shown alongside it.
    if (addMode === "import") {
      addGroup.setAttribute("aria-label", "Import from Google Classroom");
      addGroup.appendChild(importEntry(true));
      return addGroup;
    }

    // DECISION SURFACE (no task chosen; the zero-class landing): two clearly
    // labelled class sources so manual creation is never mistaken for a Google
    // Classroom action.
    addGroup.setAttribute("aria-labelledby", "classes-add-google-heading");

    const gcGroup = doc.createElement("div");
    gcGroup.className = "shell-classes-add-source";
    const gcHeading = doc.createElement("h3");
    gcHeading.className = "shell-classes-add-heading";
    gcHeading.id = "classes-add-google-heading";
    gcHeading.setAttribute("data-testid", "classes-add-google-heading");
    gcHeading.textContent = "Google Classroom";
    gcGroup.appendChild(gcHeading);
    gcGroup.appendChild(importEntry());
    addGroup.appendChild(gcGroup);

    const llGroup = doc.createElement("div");
    llGroup.className = "shell-classes-add-source";
    const llHeading = doc.createElement("h3");
    llHeading.className = "shell-classes-add-heading";
    llHeading.id = "classes-add-lyfelabz-heading";
    llHeading.setAttribute("data-testid", "classes-add-lyfelabz-heading");
    llHeading.textContent = "LyfeLabz Classes";
    llGroup.appendChild(llHeading);
    llGroup.appendChild(createControls());
    addGroup.appendChild(llGroup);

    return addGroup;
  };

  // Sprint 28.6H.8 (Part C/D/E): task-vs-landing separation. Once a class-source
  // task is chosen it renders as a FOCUSED task surface only - never the generic
  // Classes landing (no "Classes" heading, no class count, no class cards, no
  // second import/create control). Reusing the certified Classes-hosted import /
  // create implementation is encouraged; showing the generic landing as an
  // intermediate step is not.
  if (form !== null) {
    // Focused manual create task (Part F): the form carries its own
    // "Create LyfeLabz Class" heading; no generic Classes landing above it.
    // Sprint 28.6H.9 (Correction 2): a persistent "Back to Settings" control
    // sits at the top of the task (parent navigation, distinct from the
    // form's own Cancel action). Rendered only when the settings-return seam
    // is wired; it reuses onCancelCreate, which returns to Settings -> Class
    // Management and clears the draft.
    if (onGoToSettings !== null) {
      mount.appendChild(renderBackToSettings(doc, onCancelCreate));
    }
    mount.appendChild(buildAddSection());
    return;
  }
  if (addMode === "import") {
    // Focused Google Classroom import task (Part D/E): a specific task heading
    // then the certified import workflow (auto-started by the surface). No
    // Classes heading / count / cards / second Import button.
    // Sprint 28.6H.9 (Correction 2): a persistent "Back to Settings" control
    // sits above the task heading (parent navigation, distinct from the task's
    // Cancel / Close). Rendered only when the settings-return seam is wired; it
    // reuses onCancelImport, which aborts any in-flight import and returns to
    // Settings -> Class Management.
    if (onGoToSettings !== null) {
      mount.appendChild(renderBackToSettings(doc, onCancelImport));
    }
    appendHeadline(doc, mount, "Import from Google Classroom");
    mount.appendChild(buildAddSection());
    return;
  }

  // Normal Classes landing (operational only): the teacher's classes. Class
  // administration lives in Settings -> Class Management, so this surface hosts
  // NO Import / Create controls (Part C).
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  // Sprint 28.6H.3 (Task A2): class creation / import is an infrequent
  // administrative task and moves to Settings (its administrative home). The
  // everyday Classes landing therefore carries NO "+ Add class" control when
  // the teacher already has one or more classes - the class cards are the only
  // content. The underlying Import / Create workflows are not deleted: they
  // still render here transiently when the teacher chooses Import / Create in
  // Settings (the shared one-shot class-management intent routes to this
  // surface, `addOpen` below), so Settings and Classes keep ONE workflow
  // implementation. When the teacher has ZERO classes, adding/importing IS the
  // required first action and is never a dead end, so the Import / Create
  // workflow is still shown prominently and directly (empty-state branch).

  mount.appendChild(status);

  if (lastCreated !== null) {
    mount.appendChild(renderJoinCodePanel(doc, lastCreated, onDismissLastCreated));
  }

  if (!hasClasses) {
    // Sprint 28.6H.8 (Part C2): the zero-class landing is a concise
    // informational empty state that points to Settings -> Class Management. It
    // is NOT a second Import / Create decision surface - no class-administration
    // controls are rendered here.
    status.textContent = "No classes yet.";
    const region = doc.createElement("div");
    region.className = "shell-classes-region";
    region.setAttribute("data-testid", "classes-region");
    const empty = doc.createElement("p");
    empty.className = "shell-classes-empty";
    empty.setAttribute("data-testid", "classes-empty");
    empty.textContent = "Add or import a class in Settings.";
    region.appendChild(empty);
    if (onGoToSettings !== null) {
      const go = doc.createElement("button");
      go.type = "button";
      go.className = "shell-btn shell-classes-go-to-settings";
      go.setAttribute("data-testid", "classes-go-to-settings");
      go.textContent = "Go to Settings";
      go.addEventListener("click", () => onGoToSettings());
      region.appendChild(go);
    }
    mount.appendChild(region);
    return;
  }

  status.textContent =
    classes.length === 1 ? "1 class" : `${classes.length} classes`;

  // The class cards are the only content on the operational landing. No
  // class-administration controls (Import / Create moved to Settings, Part C).
  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);

  const list = doc.createElement("ul");
  list.className = "shell-classes-list";
  list.setAttribute("data-testid", "classes-list");
  list.setAttribute("role", "list");

  for (const summary of classes) {
    list.appendChild(renderClassCard(doc, summary, onOpen));
  }
  region.appendChild(list);
}

function renderImportEntryPoint(
  doc: Document,
  canImport: boolean,
  importState: ImportState,
  onStartImport: () => void,
  onSelectImportCourse: (course: IntegrationsLmsClass) => void,
  onCancelImport: () => void,
  onRetryImport: () => void,
  onOpenExistingClass: (classId: string) => void,
  // Sprint 28.6H.8 (Part D3): direct-launch mode (Settings -> Import Class). The
  // standalone "Import Class from Google Classroom" button is suppressed because
  // the flow is auto-started; a brief idle state shows a calm connecting
  // placeholder, then the authorization / discovery progression renders.
  directLaunch = false,
): HTMLElement {
  // Sprint 24B Phase 2: primary Classes entry point. Renders the Import
  // Class from Google Classroom orchestration end-to-end from Classes,
  // per SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md §4.2. When the certified
  // callable seams are not injected (canImport === false) the button
  // falls back to the Phase 1 inert stub so the surface remains coherent
  // in test harnesses that do not exercise the flow.
  const wrapper = doc.createElement("div");
  wrapper.className = "shell-classes-import";
  wrapper.setAttribute("data-testid", "classes-import");

  if (!canImport) {
    const status = doc.createElement("p");
    status.id = "classes-import-status";
    status.className = "shell-status shell-classes-import-status";
    status.setAttribute("data-testid", "classes-import-status");
    status.textContent =
      "Import Class from Google Classroom is not available right now.";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-import-open";
    btn.setAttribute("data-testid", "classes-import-open");
    btn.textContent = "Import Class from Google Classroom";
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.setAttribute("aria-describedby", "classes-import-status");
    wrapper.appendChild(btn);
    wrapper.appendChild(status);
    return wrapper;
  }

  const isBusy =
    importState.kind === "connecting" ||
    importState.kind === "discovering" ||
    importState.kind === "creating" ||
    importState.kind === "linking";
  const inFlow =
    isBusy ||
    importState.kind === "courses" ||
    importState.kind === "duplicate" ||
    importState.kind === "error";

  if (!directLaunch) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-import-open";
    btn.setAttribute("data-testid", "classes-import-open");
    btn.textContent = "Import Class from Google Classroom";
    btn.disabled = inFlow;
    if (inFlow) btn.setAttribute("aria-disabled", "true");
    if (isBusy) btn.setAttribute("aria-busy", "true");
    btn.addEventListener("click", () => onStartImport());
    wrapper.appendChild(btn);
    if (!inFlow) return wrapper;
  } else if (!inFlow) {
    // Direct-launch idle window (auto-start in flight): a calm placeholder, no
    // "Import Class" button. `role=status`/`aria-live` announces it.
    const loading = doc.createElement("p");
    loading.className = "shell-status shell-classes-import-loading";
    loading.setAttribute("data-testid", "classes-import-loading");
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.textContent = "Connecting to Google Classroom…";
    wrapper.appendChild(loading);
    return wrapper;
  }

  const panel = doc.createElement("div");
  panel.className = "shell-classes-import-panel";
  panel.setAttribute("data-testid", "classes-import-panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Import Class from Google Classroom");
  wrapper.appendChild(panel);

  // Sprint 28.6H.9 (Correction 3): the numbered four-step import process list
  // ("Sign in to Google Classroom / Load your courses / Create your LyfeLabz
  // class / Link to Google Classroom") is removed from the focused import task.
  // It exposed unnecessary implementation/process narration and added visual
  // noise; the focused task is now just the heading, the authorization /
  // loading / course-selection content, and its task actions. No controller
  // behavior changes - the stepper was pure presentation derived from
  // importState.

  switch (importState.kind) {
    case "connecting":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-connecting",
          "Opening the Google Classroom sign-in window. Complete sign-in in the pop-up to continue.",
        ),
      );
      panel.appendChild(
        renderImportCancelRow(doc, onCancelImport, "Cancel"),
      );
      return wrapper;
    case "discovering":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-discovering",
          `Loading your ${importState.providerDisplayName} courses.`,
        ),
      );
      return wrapper;
    case "courses": {
      if (importState.courses.length === 0) {
        panel.appendChild(
          renderImportMessage(
            doc,
            "classes-import-empty",
            `We did not find any ${importState.providerDisplayName} courses on this account. Create a course in ${importState.providerDisplayName} and try again.`,
          ),
        );
        panel.appendChild(
          renderImportCancelRow(doc, onCancelImport, "Close"),
        );
        return wrapper;
      }
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-pick",
          `Choose a ${importState.providerDisplayName} course to import as a LyfeLabz class.`,
        ),
      );
      const list = doc.createElement("ul");
      list.className = "shell-classes-import-courses";
      list.setAttribute("data-testid", "classes-import-courses");
      list.setAttribute("role", "list");
      for (const course of importState.courses) {
        const li = doc.createElement("li");
        li.className = "shell-classes-import-course";
        const courseBtn = doc.createElement("button");
        courseBtn.type = "button";
        courseBtn.className = "shell-classes-import-course-button";
        courseBtn.setAttribute(
          "data-testid",
          `classes-import-course-${course.lmsClassId}`,
        );
        courseBtn.setAttribute("data-lms-class-id", course.lmsClassId);
        const title = doc.createElement("span");
        title.className = "shell-classes-import-course-title";
        title.textContent = course.name;
        courseBtn.appendChild(title);
        if (course.section && course.section.length > 0) {
          const section = doc.createElement("span");
          section.className = "shell-classes-import-course-section";
          section.textContent = course.section;
          courseBtn.appendChild(section);
        }
        courseBtn.addEventListener("click", () =>
          onSelectImportCourse(course),
        );
        li.appendChild(courseBtn);
        list.appendChild(li);
      }
      panel.appendChild(list);
      panel.appendChild(renderImportCancelRow(doc, onCancelImport, "Cancel"));
      return wrapper;
    }
    case "duplicate": {
      const dup = doc.createElement("div");
      dup.className = "shell-classes-import-duplicate";
      dup.setAttribute("data-testid", "classes-import-duplicate");
      const heading = doc.createElement("h3");
      heading.className = "shell-classes-import-duplicate-heading";
      heading.textContent = "This course is already imported";
      dup.appendChild(heading);
      const body = doc.createElement("p");
      body.className = "shell-status";
      body.textContent = `"${importState.course.name}" is already connected to your LyfeLabz class "${importState.existingClassTitle}".`;
      dup.appendChild(body);
      const actions = doc.createElement("div");
      actions.className = "shell-classes-import-duplicate-actions";
      const openBtn = doc.createElement("button");
      openBtn.type = "button";
      openBtn.className = "shell-classes-import-open-existing";
      openBtn.setAttribute("data-testid", "classes-import-open-existing");
      openBtn.textContent = "Open class";
      openBtn.addEventListener("click", () =>
        onOpenExistingClass(importState.existingClassId),
      );
      actions.appendChild(openBtn);
      const cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "shell-classes-import-cancel";
      cancelBtn.setAttribute("data-testid", "classes-import-cancel");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => onCancelImport());
      actions.appendChild(cancelBtn);
      dup.appendChild(actions);
      panel.appendChild(dup);
      return wrapper;
    }
    case "creating":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-creating",
          `Creating your LyfeLabz class for "${importState.course.name}".`,
        ),
      );
      return wrapper;
    case "linking":
      panel.appendChild(
        renderImportMessage(
          doc,
          "classes-import-linking",
          `Linking "${importState.course.name}" to Google Classroom.`,
        ),
      );
      return wrapper;
    case "error": {
      const err = doc.createElement("p");
      err.className = "shell-classes-import-error";
      err.setAttribute("data-testid", "classes-import-error");
      err.setAttribute("role", "alert");
      err.textContent = importState.message;
      panel.appendChild(err);
      if (importState.recoveryHint) {
        const hint = doc.createElement("p");
        hint.className = "shell-status shell-classes-import-error-hint";
        hint.setAttribute("data-testid", "classes-import-error-hint");
        hint.textContent = importState.recoveryHint;
        panel.appendChild(hint);
      }
      const actions = doc.createElement("div");
      actions.className = "shell-classes-import-error-actions";
      if (importState.stage !== "linking") {
        const retry = doc.createElement("button");
        retry.type = "button";
        retry.className = "shell-classes-import-retry";
        retry.setAttribute("data-testid", "classes-import-retry");
        retry.textContent = "Try again";
        retry.addEventListener("click", () => onRetryImport());
        actions.appendChild(retry);
      }
      const cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "shell-classes-import-cancel";
      cancelBtn.setAttribute("data-testid", "classes-import-cancel");
      cancelBtn.textContent = "Close";
      cancelBtn.addEventListener("click", () => onCancelImport());
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);
      return wrapper;
    }
    default:
      return wrapper;
  }
}

// Sprint 28.6H.9 (Correction 3): the numbered import stepper
// (`renderImportStages` + IMPORT_STAGE_LABEL / IMPORT_STAGE_ORDER) is removed.
// The focused import task no longer narrates the internal connect -> discover
// -> create -> link process; it shows only the heading, the live
// authorization / loading / course-selection content, and its task actions.
// The `ImportStage` type and `importState.stage` field are unchanged (still
// used by the error-recovery branch); only the presentational stepper is gone.

// Sprint 28.6H.9 (Correction 2): persistent parent navigation for a focused
// Settings child task (Import from Google Classroom / Create LyfeLabz Class).
// Mirrors the certified "Back to Classes" control (`shell-class-workspace-back`
// idiom): a quiet text-weight button near the top of the task that returns to
// Settings -> Class Management. It is navigation, NOT the task action, so it
// coexists with the task-specific Create Class / Cancel / Try again / Close
// controls; it reuses the existing settings-return handler (which also tears
// down any in-flight import) rather than adding a new routing path.
function renderBackToSettings(
  doc: Document,
  onBackToSettings: () => void,
): HTMLElement {
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-classes-back-to-settings";
  back.setAttribute("data-testid", "classes-back-to-settings");
  back.textContent = "Back to Settings";
  back.setAttribute("aria-label", "Back to Settings");
  back.addEventListener("click", () => onBackToSettings());
  return back;
}

function renderImportMessage(
  doc: Document,
  testid: string,
  text: string,
): HTMLElement {
  const p = doc.createElement("p");
  p.className = "shell-status shell-classes-import-message";
  p.setAttribute("data-testid", testid);
  p.setAttribute("role", "status");
  p.setAttribute("aria-live", "polite");
  p.textContent = text;
  return p;
}

function renderImportCancelRow(
  doc: Document,
  onCancelImport: () => void,
  label: string,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "shell-classes-import-actions";
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "shell-classes-import-cancel";
  btn.setAttribute("data-testid", "classes-import-cancel");
  btn.textContent = label;
  btn.addEventListener("click", () => onCancelImport());
  row.appendChild(btn);
  return row;
}

function renderCreateControls(
  doc: Document,
  form: CreateFormState | null,
  onStartCreate: () => void,
  onCancelCreate: () => void,
  onFormChange: (patch: Partial<CreateFormState>) => void,
  onSubmitCreate: () => void,
): HTMLElement {
  const wrapper = doc.createElement("div");
  wrapper.className = "shell-classes-create";
  wrapper.setAttribute("data-testid", "classes-create");

  if (form === null) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-classes-create-open";
    btn.setAttribute("data-testid", "classes-create-open");
    btn.textContent = "Create LyfeLabz Class";
    btn.addEventListener("click", () => onStartCreate());
    wrapper.appendChild(btn);
    return wrapper;
  }

  const formEl = doc.createElement("form");
  formEl.className = "shell-form shell-classes-create-form";
  formEl.setAttribute("data-testid", "classes-create-form");
  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onSubmitCreate();
  });

  const heading = doc.createElement("h3");
  heading.className = "shell-classes-create-heading";
  heading.textContent = "Create LyfeLabz Class";
  formEl.appendChild(heading);

  const titleLabel = doc.createElement("label");
  titleLabel.textContent = "Class name";
  const titleInput = doc.createElement("input");
  titleInput.type = "text";
  titleInput.required = true;
  titleInput.value = form.title;
  titleInput.setAttribute("data-testid", "classes-create-title");
  titleInput.disabled = form.submitting;
  titleInput.addEventListener("input", () => {
    onFormChange({ title: titleInput.value });
  });
  titleLabel.appendChild(titleInput);
  formEl.appendChild(titleLabel);

  const gradeLabel = doc.createElement("label");
  gradeLabel.textContent = "Grade";
  const gradeSelect = doc.createElement("select");
  gradeSelect.setAttribute("data-testid", "classes-create-grade");
  gradeSelect.disabled = form.submitting;
  // Phase 2B.4: placeholder option so the "no selection" state is
  // explicit. The teacher must choose a grade before submit succeeds.
  const gradePlaceholder = doc.createElement("option");
  gradePlaceholder.value = "";
  gradePlaceholder.textContent = "Choose a grade";
  if (form.grade === "") gradePlaceholder.selected = true;
  gradeSelect.appendChild(gradePlaceholder);
  for (const g of ["6", "7", "8"]) {
    const opt = doc.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if (g === form.grade) opt.selected = true;
    gradeSelect.appendChild(opt);
  }
  gradeSelect.addEventListener("change", () => {
    onFormChange({ grade: gradeSelect.value });
  });
  gradeLabel.appendChild(gradeSelect);
  formEl.appendChild(gradeLabel);

  const blockLabel = doc.createElement("label");
  blockLabel.textContent = "Block";
  const blockSelect = doc.createElement("select");
  blockSelect.setAttribute("data-testid", "classes-create-block");
  blockSelect.disabled = form.submitting;
  // Phase 2B.4: placeholder option so block always begins empty.
  const blockPlaceholder = doc.createElement("option");
  blockPlaceholder.value = "";
  blockPlaceholder.textContent = "Choose a block";
  if (form.block === "") blockPlaceholder.selected = true;
  blockSelect.appendChild(blockPlaceholder);
  for (const b of ["A", "B", "C", "D", "E", "F", "G"]) {
    const opt = doc.createElement("option");
    opt.value = b;
    opt.textContent = b;
    if (b === form.block) opt.selected = true;
    blockSelect.appendChild(opt);
  }
  blockSelect.addEventListener("change", () => {
    onFormChange({ block: blockSelect.value });
  });
  blockLabel.appendChild(blockSelect);
  formEl.appendChild(blockLabel);

  if (form.error !== null) {
    const err = doc.createElement("p");
    err.setAttribute("role", "alert");
    err.setAttribute("data-testid", "classes-create-error");
    err.className = "shell-classes-create-error";
    err.textContent = form.error;
    formEl.appendChild(err);
  }

  const actions = doc.createElement("div");
  actions.className = "shell-classes-create-actions";

  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.setAttribute("data-testid", "classes-create-submit");
  // Sprint 28.6H.6 (Task F4): the heading already establishes this is a
  // LyfeLabz class, so the submit reads the shorter "Create Class".
  submit.textContent = form.submitting ? "Creating" : "Create Class";
  submit.disabled = form.submitting;
  if (form.submitting) submit.setAttribute("aria-busy", "true");
  actions.appendChild(submit);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-classes-create-cancel";
  cancel.setAttribute("data-testid", "classes-create-cancel");
  cancel.textContent = "Cancel";
  cancel.disabled = form.submitting;
  cancel.addEventListener("click", () => onCancelCreate());
  actions.appendChild(cancel);

  formEl.appendChild(actions);
  wrapper.appendChild(formEl);
  return wrapper;
}

function renderJoinCodePanel(
  doc: Document,
  result: CreateClassResult,
  onDismiss: () => void,
): HTMLElement {
  const panel = doc.createElement("div");
  panel.className = "shell-classes-joincode";
  panel.setAttribute("data-testid", "classes-joincode-panel");
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");

  const heading = doc.createElement("h3");
  heading.className = "shell-classes-joincode-heading";
  heading.textContent = result.alreadyCreated
    ? "Class already exists"
    : "Class created";
  panel.appendChild(heading);

  const label = doc.createElement("p");
  label.className = "shell-classes-joincode-label";
  label.textContent = "Student join code";
  panel.appendChild(label);

  const code = doc.createElement("p");
  code.className = "shell-classes-joincode-value";
  code.setAttribute("data-testid", "classes-joincode-value");
  code.textContent = result.joinCode;
  panel.appendChild(code);

  const hint = doc.createElement("p");
  hint.className = "shell-classes-joincode-hint";
  hint.textContent =
    "Share this code with your students so they can join this class. The code stays on the class card.";
  panel.appendChild(hint);

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.className = "shell-classes-joincode-dismiss";
  dismiss.setAttribute("data-testid", "classes-joincode-dismiss");
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => onDismiss());
  panel.appendChild(dismiss);

  return panel;
}

function renderClassCard(
  doc: Document,
  summary: ClassSummary,
  onOpen: (classId: string) => void,
): HTMLElement {
  const li = doc.createElement("li");
  li.className = "shell-classes-item";

  const card = doc.createElement("button");
  card.type = "button";
  card.className = "shell-card shell-class-card";
  card.setAttribute("data-testid", `class-card-${summary.id}`);
  card.setAttribute("data-class-id", summary.id);
  card.setAttribute(
    "aria-label",
    `Open ${summary.title}`,
  );

  const title = doc.createElement("h3");
  title.className = "shell-class-title";
  title.setAttribute("data-testid", `class-title-${summary.id}`);
  title.textContent = summary.title;
  card.appendChild(title);

  if (summary.status === "needsSetup") {
    // Phase 2B.4: the needsSetup card renders a calm status line plus
    // a Finish setup affordance. Join code, grade, block, roster
    // actions, and assignment actions are intentionally absent
    // (Spec §8, §9). The whole card remains clickable as a Finish
    // setup control; the visible affordance is redundant with the
    // card's action but names it in teacher-facing language.
    const affordance = doc.createElement("p");
    affordance.className = "shell-class-setup-affordance";
    affordance.setAttribute(
      "data-testid",
      `class-setup-affordance-${summary.id}`,
    );
    affordance.textContent = "Finish setting up this class before using it with students.";
    card.appendChild(affordance);
    const finishSetup = doc.createElement("span");
    finishSetup.className = "shell-class-setup-cta";
    finishSetup.setAttribute(
      "data-testid",
      `class-setup-cta-${summary.id}`,
    );
    finishSetup.textContent = "Finish setup";
    card.appendChild(finishSetup);
  } else {
    const gradeText = compactGradeBlock(summary);
    if (gradeText !== null) {
      const grade = doc.createElement("p");
      grade.className = "shell-class-grade";
      grade.setAttribute("data-testid", `class-grade-${summary.id}`);
      // Sprint 28.6C/H: compact grade presentation (`G6 · Block A`), shared
      // with the class-workspace header via `compactGradeBlock`.
      grade.textContent = gradeText;
      card.appendChild(grade);
    }

    // Sprint 28.6H.3 (Task A1): the generic assignment-inventory count
    // ("4 assignments" / "No assignments") is removed from the everyday
    // Classes card. The total number of assignments is not decision-useful
    // enough to deserve card-level emphasis, and the Assignments tab already
    // exposes the full inventory. Per Task A1 it is NOT replaced with another
    // bare statistic; the card carries only stable class identity (title +
    // grade/block). The operational-attention data a teacher actually wants
    // ("who has not completed this assignment", "who newly completed it") is
    // not available to the Classes landing without per-assignment summary
    // reads (N+1) or a durable teacher checkpoint that does not yet exist -
    // see the Sprint 28.6H.3 record and STOP-condition investigation. No new
    // read is invented here merely to decorate the card.

    // Sprint 28.6I: the join code is intentionally not shown on the class
    // card. The card carries only what helps a teacher browse the class list
    // (title, grade/block, assignment count). The join code remains available
    // on the dedicated surfaces (the post-create "Student join code" panel and
    // class settings); `summary.joinCode` and all join-code data are untouched.
  }

  // Sprint 28.6H (Finding 2): the "Active" status badge is removed from the
  // class card. A class that appears in the everyday Classes workspace is
  // implicitly active, so the badge merely repeated the current state and
  // carried no teacher decision. The needsSetup state is still communicated -
  // by the "Finish setup" affordance and its copy above - so no status pill is
  // needed here. Backend activation/status semantics are unchanged; this is a
  // presentation-only removal.

  card.addEventListener("click", () => {
    onOpen(summary.id);
  });

  li.appendChild(card);
  return li;
}

// Sprint 24B Phase 2B.8. Ephemeral roster-sync state for the currently
// visible class, threaded from the surface's per-class map into the
// workspace renderer without leaking the map itself. `available` is
// false when the syncRoster wrapper is not wired at all (test harness
// mode); the button and summary are simply omitted in that case.
export type RosterSyncViewEntry =
  | { readonly status: "idle" }
  | { readonly status: "syncing" }
  | { readonly status: "ok"; readonly counters: SyncRosterCounters; readonly at: number }
  | { readonly status: "error"; readonly kind: SyncRosterError["kind"]; readonly at: number };

// Sprint 28.6H.3 (Task C4): exported so Settings → Class Management can reuse
// the exact certified roster-sync status panel (same aggregate-only copy, same
// error taxonomy) rather than duplicating it. The underlying
// `lmsClassesSyncRoster` callable and its semantics are unchanged.
export type RosterSyncView = {
  readonly available: boolean;
  readonly entry: RosterSyncViewEntry;
  readonly onSyncClick: () => void;
};

function renderClassWorkspaceState(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  tab: ClassWorkspaceTab,
  onSelectTab: (tab: ClassWorkspaceTab) => void,
  onBack: () => void,
  setupForm: SetupFormState | null,
  onSetupFormChange: (patch: Partial<SetupFormState>) => void,
  onSubmitSetup: () => void,
  onCancelSetup: () => void,
  canActivate: boolean,
  assignmentsView: ClassAssignmentsView,
): void {
  const workspace = doc.createElement("div");
  workspace.className = "shell-class-workspace";
  workspace.setAttribute("data-testid", "class-workspace");
  workspace.setAttribute("data-class-id", summary.id);
  workspace.setAttribute("data-class-tab", tab);
  mount.appendChild(workspace);

  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-class-workspace-back";
  back.setAttribute("data-testid", "class-workspace-back");
  back.textContent = "Back to Classes";
  back.setAttribute("aria-label", "Back to Classes");
  back.addEventListener("click", () => {
    onBack();
  });
  workspace.appendChild(back);

  // Phase 2B.4: a needsSetup class renders only the setup form.
  // Snapshot / Roster navigation is intentionally hidden until the
  // class becomes active.
  if (summary.status === "needsSetup") {
    const surfaceMount = doc.createElement("div");
    surfaceMount.className = "shell-class-surface shell-class-surface-setup";
    surfaceMount.setAttribute("data-testid", "class-surface");
    workspace.appendChild(surfaceMount);
    renderSetupSurface(
      doc,
      surfaceMount,
      summary,
      setupForm ?? emptySetupForm(),
      onSetupFormChange,
      onSubmitSetup,
      onCancelSetup,
      canActivate,
    );
    return;
  }

  // Sprint 28.6H (Finding 3): the CLASS is the primary object. Its identity -
  // name, then compact grade/block - appears BEFORE the tabs, so the tabs read
  // as belonging to this class. The "Active" badge is removed (Finding 2); a
  // class in the everyday workspace is implicitly active.
  const identity = doc.createElement("div");
  identity.className = "shell-class-workspace-identity";
  identity.setAttribute("data-testid", "class-workspace-identity");

  const title = doc.createElement("h2");
  title.className = "shell-welcome shell-class-workspace-title";
  title.setAttribute("data-testid", "class-workspace-title");
  title.textContent = summary.title;
  identity.appendChild(title);

  const meta = compactGradeBlock(summary);
  if (meta !== null) {
    const metaEl = doc.createElement("p");
    metaEl.className = "shell-class-workspace-meta";
    metaEl.setAttribute("data-testid", "class-workspace-meta");
    metaEl.textContent = meta;
    identity.appendChild(metaEl);
  }
  workspace.appendChild(identity);

  // Sprint 28.6H.3 (Task B3): the class workspace is operational only. The
  // "Manage class" disclosure (and the Sync roster action it hosted) is removed
  // from every everyday class-workspace location; administrative class
  // management - including roster sync for Google Classroom-linked classes -
  // now lives in Settings → Class Management (Task C4). The tab row therefore
  // holds only the class sections (Assignments | Students).
  const tabRow = doc.createElement("div");
  tabRow.className = "shell-class-tabrow";
  tabRow.appendChild(renderClassNavigation(doc, tab, onSelectTab));
  workspace.appendChild(tabRow);

  const surfaceMount = doc.createElement("div");
  surfaceMount.className = `shell-class-surface shell-class-surface-${tab}`;
  surfaceMount.setAttribute("data-testid", "class-surface");
  workspace.appendChild(surfaceMount);

  // Sprint 28.6H.3 (Task B1): Overview/Snapshot is retired. The only class
  // sections are Assignments (the default) and Students; a stale `snapshot`
  // tab defensively renders Assignments rather than an empty surface.
  if (tab === "roster") {
    renderRosterSurface(doc, surfaceMount);
  } else {
    renderClassAssignmentsSurface(doc, surfaceMount, summary, assignmentsView);
  }
}

// Sprint 28.6H (Finding 3): the compact class convention used on the class
// card and the workspace header - `G6 · Block B`, or `G6` when no block, or
// null when grade is absent. Never invents a block that is not present.
// Sprint 28.6H.3 (Task C4): exported so the Settings class-management list
// renders the same compact grade/block line as the Classes surface.
export function compactGradeBlock(summary: ClassSummary): string | null {
  if (summary.status === "needsSetup") return null;
  if (summary.grade.length === 0) return null;
  return summary.block && summary.block.length > 0
    ? `G${summary.grade} · Block ${summary.block}`
    : `G${summary.grade}`;
}

// Sprint 28.6C: the class-scoped Assignments section. Shows only this class's
// assignments (published + closed) by reusing the certified Active Assignments
// renderer in its flat, classId-filtered form; each row opens the existing
// Assignment Detail. A class with no assignments gets a calm empty state that
// points the teacher to Curriculum to choose a lesson (the Curriculum-first
// lesson-selection model is preserved - no assignment is created here).
function renderClassAssignmentsSurface(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  assignmentsView: ClassAssignmentsView,
): void {
  // Sprint 28.6H (Finding 3): the class identity is the workspace header above
  // the tabs, so the tab surface heading is the SECTION name, not the class
  // title (which would otherwise appear twice).
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-class-assignments-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Assignments";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  // Sprint 28.6H.4 (Part A): the introductory sentence ("The assignments you
  // have given this class.") is removed - the "Assignments" heading is
  // self-explanatory and flows directly into the assignment cards.

  // Count using the same predicate as the class card so the two never
  // disagree. When there is nothing to show, render the calm empty state.
  const hasAny =
    assignmentsView.enabled &&
    assignmentsView
      .listRegistry()
      .some((m) => m.classId === summary.id && isRenderableCard(m));

  if (!hasAny) {
    // Sprint 28.6H.4 (Part A): the empty state is exactly "No assignments
    // yet." The over-explaining hint ("Choose a lesson in Curriculum...") and
    // the "Go to Curriculum" button are removed; the teacher reaches Curriculum
    // through the primary navigation.
    const empty = doc.createElement("div");
    empty.className = "shell-class-assignments-empty";
    empty.setAttribute("data-testid", "class-assignments-empty");
    empty.setAttribute("role", "status");

    const emptyMsg = doc.createElement("p");
    emptyMsg.className = "shell-class-assignments-empty-message";
    emptyMsg.textContent = "No assignments yet.";
    empty.appendChild(emptyMsg);

    mount.appendChild(empty);
    return;
  }

  const sectionMount = doc.createElement("div");
  sectionMount.className = "shell-class-assignments-section";
  sectionMount.setAttribute("data-testid", "class-assignments-section");
  mount.appendChild(sectionMount);

  renderActiveAssignmentsSection(sectionMount, {
    listRegistry: assignmentsView.listRegistry,
    open: (assignmentId) => {
      assignmentsView.open(summary.id, assignmentId);
    },
    summaryCallable: assignmentsView.summaryCallable,
    classIdFilter: summary.id,
    flat: true,
  });
}

// Sprint 24B Phase 2B.8. Sync roster affordance + summary panel. Aggregate
// counters only; no student names, emails, provider account identifiers,
// or Google identifiers ever appear here or in any log line this panel
// emits (it emits none).
export function renderRosterSyncPanel(
  doc: Document,
  rosterSync: RosterSyncView,
): HTMLElement {
  const panel = doc.createElement("section");
  panel.className = "shell-class-rostersync";
  panel.setAttribute("data-testid", "class-rostersync");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Roster synchronization");

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "shell-class-rostersync-button";
  button.setAttribute("data-testid", "class-rostersync-button");
  button.textContent = "Sync roster";
  const inFlight = rosterSync.entry.status === "syncing";
  button.disabled = inFlight;
  if (inFlight) button.setAttribute("aria-busy", "true");
  button.addEventListener("click", () => {
    if (button.disabled) return;
    rosterSync.onSyncClick();
  });
  panel.appendChild(button);

  const status = doc.createElement("p");
  status.className = "shell-class-rostersync-status";
  status.setAttribute("data-testid", "class-rostersync-status");
  status.setAttribute("aria-live", "polite");

  switch (rosterSync.entry.status) {
    case "idle":
      // Sprint 28.6H.4 (Task E6): the explanatory sentence ("Sync brings the
      // latest Google Classroom roster into LyfeLabz.") is removed; the
      // "Sync roster" action is self-explanatory in this administrative
      // context. The live region is retained (empty) so a later sync's
      // success / error status is still announced.
      status.textContent = "";
      break;
    case "syncing":
      status.textContent = "Synchronizing roster with Google Classroom.";
      break;
    case "ok": {
      const c = rosterSync.entry.counters;
      // Truthful aggregate summary. Zero values are always shown so the
      // teacher can distinguish "no changes" from "not yet synced".
      const parts: string[] = [];
      parts.push(`Added: ${c.added}`);
      parts.push(`Unchanged: ${c.unchanged}`);
      parts.push(`Withdrawn: ${c.withdrawn}`);
      // Sprint 29F: replace the raw "Unresolved: N" label with plain-language
      // guidance. `unresolved` means those Classroom students have no usable
      // active LyfeLabz identity yet (they have not finished signing in with
      // their school Google account), so the teacher's next step is concrete:
      // have them sign in, then sync again. The count is preserved inside the
      // sentence; it never appears as a bare unexplained number. Singular and
      // plural are handled so the copy always reads naturally.
      let sentence = `Roster synced. ${parts.join(", ")}.`;
      if (c.unresolved > 0) {
        const guidance =
          c.unresolved === 1
            ? "1 student hasn't finished signing in to LyfeLabz with their school Google account yet. Ask them to sign in, then sync the roster again."
            : `${c.unresolved} students haven't finished signing in to LyfeLabz with their school Google accounts yet. Ask them to sign in, then sync the roster again.`;
        sentence = `${sentence} ${guidance}`;
      }
      status.textContent = sentence;
      panel.setAttribute("data-rostersync-status", "ok");
      break;
    }
    case "error": {
      const kind = rosterSync.entry.kind;
      // Calm plain-language recovery copy. No provider identifiers,
      // student names, or emails are ever included.
      switch (kind) {
        case "reconnectRequired":
          status.textContent =
            "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try Sync roster again.";
          break;
        case "linkBroken":
          status.textContent =
            "This class's Google Classroom course could not be reached. Confirm the course is still available and try again.";
          break;
        case "classNotActive":
          status.textContent =
            "This class is no longer active, so its roster cannot be synchronized.";
          break;
        case "transient":
          status.textContent =
            "We could not reach Google Classroom just now. Try Sync roster again in a moment.";
          break;
        case "unknown":
        default:
          status.textContent =
            "Roster synchronization did not finish. Try Sync roster again in a moment.";
          break;
      }
      panel.setAttribute("data-rostersync-status", "error");
      panel.setAttribute("data-rostersync-error-kind", kind);
      break;
    }
  }

  panel.appendChild(status);
  return panel;
}

// One-screen imported-class setup form. Asks only for grade and block,
// both starting empty; the teacher chooses them for this class.
function renderSetupSurface(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  form: SetupFormState,
  onFormChange: (patch: Partial<SetupFormState>) => void,
  onSubmit: () => void,
  onCancel: () => void,
  canActivate: boolean,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-class-setup-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = `Finish setting up ${summary.title}`;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const intro = doc.createElement("p");
  intro.className = "shell-status shell-class-setup-intro";
  intro.setAttribute("data-testid", "class-setup-intro");
  intro.textContent =
    "Choose the grade and class block before using this class with students.";
  mount.appendChild(intro);

  const formEl = doc.createElement("form");
  formEl.className = "shell-form shell-class-setup-form";
  formEl.setAttribute("data-testid", "class-setup-form");
  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onSubmit();
  });

  const gradeLabel = doc.createElement("label");
  gradeLabel.textContent = "Grade";
  const gradeSelect = doc.createElement("select");
  gradeSelect.setAttribute("data-testid", "class-setup-grade");
  gradeSelect.disabled = form.submitting;
  const gradePlaceholder = doc.createElement("option");
  gradePlaceholder.value = "";
  gradePlaceholder.textContent = "Choose a grade";
  if (form.grade === "") gradePlaceholder.selected = true;
  gradeSelect.appendChild(gradePlaceholder);
  for (const g of ["6", "7", "8"]) {
    const opt = doc.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if (g === form.grade) opt.selected = true;
    gradeSelect.appendChild(opt);
  }
  gradeSelect.addEventListener("change", () => {
    onFormChange({ grade: gradeSelect.value });
  });
  gradeLabel.appendChild(gradeSelect);
  formEl.appendChild(gradeLabel);

  const blockLabel = doc.createElement("label");
  blockLabel.textContent = "Block";
  const blockSelect = doc.createElement("select");
  blockSelect.setAttribute("data-testid", "class-setup-block");
  blockSelect.disabled = form.submitting;
  const blockPlaceholder = doc.createElement("option");
  blockPlaceholder.value = "";
  blockPlaceholder.textContent = "Choose a block";
  if (form.block === "") blockPlaceholder.selected = true;
  blockSelect.appendChild(blockPlaceholder);
  for (const b of ["A", "B", "C", "D", "E", "F", "G"]) {
    const opt = doc.createElement("option");
    opt.value = b;
    opt.textContent = b;
    if (b === form.block) opt.selected = true;
    blockSelect.appendChild(opt);
  }
  blockSelect.addEventListener("change", () => {
    onFormChange({ block: blockSelect.value });
  });
  blockLabel.appendChild(blockSelect);
  formEl.appendChild(blockLabel);

  if (form.error !== null) {
    const err = doc.createElement("p");
    err.setAttribute("role", "alert");
    err.setAttribute("data-testid", "class-setup-error");
    err.className = "shell-class-setup-error";
    err.textContent = form.error;
    formEl.appendChild(err);
  }

  if (!canActivate) {
    const unavailable = doc.createElement("p");
    unavailable.setAttribute("role", "status");
    unavailable.setAttribute("data-testid", "class-setup-unavailable");
    unavailable.className = "shell-status shell-class-setup-unavailable";
    unavailable.textContent =
      "Class setup is not available right now. Reload the page and try again.";
    formEl.appendChild(unavailable);
  }

  const actions = doc.createElement("div");
  actions.className = "shell-class-setup-actions";

  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.setAttribute("data-testid", "class-setup-submit");
  submit.textContent = form.submitting ? "Finishing setup" : "Finish setup";
  submit.disabled = form.submitting || !canActivate;
  if (form.submitting) submit.setAttribute("aria-busy", "true");
  actions.appendChild(submit);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-class-setup-cancel";
  cancel.setAttribute("data-testid", "class-setup-cancel");
  cancel.textContent = "Cancel";
  cancel.disabled = form.submitting;
  cancel.addEventListener("click", () => onCancel());
  actions.appendChild(cancel);

  formEl.appendChild(actions);
  mount.appendChild(formEl);
}

function renderClassNavigation(
  doc: Document,
  tab: ClassWorkspaceTab,
  onSelectTab: (tab: ClassWorkspaceTab) => void,
): HTMLElement {
  const nav = doc.createElement("nav");
  nav.className = "shell-class-nav";
  nav.setAttribute("aria-label", "Class sections");
  nav.setAttribute("data-testid", "class-nav");

  const list = doc.createElement("ul");
  list.className = "shell-class-nav-list";
  list.setAttribute("role", "list");

  // Sprint 28.6H.3 (Task B1): Overview is removed from the class navigation.
  // Human review found it redundant - the teacher's useful class-level
  // destinations are Assignments and Students. The final navigation is exactly
  // `Assignments | Students`; the retired Overview/Snapshot tab is not hidden
  // by CSS, it is absent from the operational navigation model. The internal
  // `roster` key is kept stable so the certified Students switcher testid and
  // its tests are preserved.
  const items: ReadonlyArray<{
    readonly key: ClassWorkspaceTab;
    readonly label: string;
  }> = Object.freeze([
    Object.freeze({ key: "assignments" as const, label: "Assignments" }),
    Object.freeze({ key: "roster" as const, label: "Students" }),
  ]);

  for (const item of items) {
    const li = doc.createElement("li");
    li.className = "shell-class-nav-item";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "shell-class-nav-button";
    btn.setAttribute("data-testid", `class-nav-${item.key}`);
    btn.textContent = item.label;
    if (item.key === tab) {
      btn.setAttribute("aria-current", "page");
      btn.classList.add("shell-class-nav-active");
    }
    btn.addEventListener("click", () => {
      onSelectTab(item.key);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }

  nav.appendChild(list);
  return nav;
}

function renderRosterSurface(doc: Document, mount: HTMLElement): void {
  // Sprint 28.6H (Finding 3/5): section heading is "Students" (the class
  // identity is the workspace header). No prototype/product-marketing copy;
  // a real empty state until a roster is wired.
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-roster-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Students";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  // Sprint 28.6H.4 (Part B): the empty state is exactly "No students yet."
  // The class-code explanatory sentence is removed - it over-explained and was
  // too specific to manually joined LyfeLabz classes now that Google Classroom
  // roster import exists.
  const empty = doc.createElement("div");
  empty.className = "shell-roster-empty";
  empty.setAttribute("data-testid", "roster-empty");
  empty.setAttribute("role", "status");

  const emptyMsg = doc.createElement("p");
  emptyMsg.className = "shell-roster-empty-message";
  emptyMsg.textContent = "No students yet.";
  empty.appendChild(emptyMsg);

  mount.appendChild(empty);
}

function appendHeadline(
  doc: Document,
  mount: HTMLElement,
  text: string,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = text;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }
}
