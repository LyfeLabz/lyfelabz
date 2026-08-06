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
  ImportStage,
  ImportState,
} from "../../classes/importFromClassroom";
import { createImportFromClassroom } from "../../classes/importFromClassroom";
import type { IntegrationsLmsClass } from "../../settings/integrations/types";
import type {
  TeacherDefaultGrade,
  UpdateTeacherDefaultGrade,
} from "../../teacherPreferences/types";
import { isTeacherDefaultGrade } from "../../teacherPreferences/types";
import {
  renderSnapshotSurface,
  type SnapshotPreview,
} from "./snapshot";

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
export type ClassWorkspaceTab = "snapshot" | "roster" | "setup";

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
  // Sprint 24B Phase 2B.2: teacher `defaultGrade` convenience
  // preference. When present, the Manual Create form seeds its grade
  // select from this value instead of the hard-coded default. When
  // null (no preference or read failure) the form falls back to the
  // pre-Phase 2B.2 seed of "7" (retirement of the hard-coded default
  // is deferred to Phase 2B.4 per Reader Audit §5 C12).
  readonly defaultGrade?: TeacherDefaultGrade | null;
  // Sprint 24B Phase 2B.2: best-effort preference-update seam invoked
  // after a successful Manual Create submission. Called with the
  // teacher-selected grade so a later Manual Create pre-fills the same
  // grade ("most recently confirmed grade wins"). The update is
  // fire-and-forget; a rejection is swallowed so class creation
  // cannot be undone or surfaced as an error because of a preference
  // storage failure.
  readonly updateDefaultGrade?: UpdateTeacherDefaultGrade | null;
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
};

// Every arm of `ClassSummary["status"]` must have a label. The
// `needsSetup` label lands here in Phase 2B.1; the "Finish setting up
// this class" affordance and the workspace-hosted setup form are
// deferred to Phase 2B.4. See docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md §5 C6.
const STATUS_LABEL: Readonly<Record<ClassSummary["status"], string>> =
  Object.freeze({
    active: "Active",
    archived: "Archived",
    needsSetup: "Setup needed",
  });

type CreateFormState = {
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly submitting: boolean;
  readonly error: string | null;
};

// Phase 2B.4: setup form state for the imported-class workspace. Grade
// may prefill from the teacher's saved defaultGrade when present; the
// teacher may always override it. Block never prefills.
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

// Phase 2B.4: retire the hard-coded Grade 7 fallback. When no
// preference is present, grade begins empty and the teacher must
// choose explicitly. Block always begins empty; there is no
// `defaultBlock` at any layer (ADR §12).
const emptyForm = (seedGrade: TeacherDefaultGrade | null): CreateFormState =>
  Object.freeze({
    title: "",
    grade: seedGrade !== null && isTeacherDefaultGrade(seedGrade) ? seedGrade : "",
    block: "",
    submitting: false,
    error: null,
  });

// Phase 2B.4: initial setup-form state. Grade prefills from the saved
// preference when it is a valid closed-set value; otherwise it begins
// empty and the teacher must choose. Block always begins empty.
const emptySetupForm = (
  seedGrade: TeacherDefaultGrade | null,
): SetupFormState =>
  Object.freeze({
    grade: seedGrade !== null && isTeacherDefaultGrade(seedGrade) ? seedGrade : "",
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
  const preview = deps.snapshotPreview ?? null;
  const createClass = deps.createClass ?? null;
  const importDeps = deps.importFromClassroom ?? null;
  const defaultGrade: TeacherDefaultGrade | null = deps.defaultGrade ?? null;
  const updateDefaultGrade = deps.updateDefaultGrade ?? null;
  const activateClass = deps.activateClass ?? null;
  const syncRoster = deps.syncRoster ?? null;

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

  const getRosterSyncEntry = (classId: string): RosterSyncEntry =>
    rosterSyncByClass.get(classId) ?? { status: "idle" };

  const isSyncInFlight = (classId: string): boolean =>
    getRosterSyncEntry(classId).status === "syncing";

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
          createClass !== null,
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
          preview,
          onSelectTab,
          onBackToList,
          s.setupForm,
          onSetupFormChange,
          onSubmitSetup,
          onCancelSetup,
          activateClass !== null,
          {
            available: syncRoster !== null,
            entry: getRosterSyncEntry(summary.id),
            onSyncClick: () => runRosterSync(summary.id),
          },
        );
        return;
      }
    }
  };

  const idleImportState = (): ImportState =>
    Object.freeze({ kind: "idle" as const });

  const onOpenClass = (classId: string): void => {
    if (state.kind !== "list") return;
    const summary = state.classes.find((c) => c.id === classId);
    // Phase 2B.4: a needsSetup class opens directly on the setup form.
    // Snapshot and Roster are unreachable until activation completes.
    const isNeedsSetup = summary?.status === "needsSetup";
    state = {
      kind: "workspace",
      classes: state.classes,
      selectedId: classId,
      tab: isNeedsSetup ? "setup" : "snapshot",
      setupForm: isNeedsSetup ? emptySetupForm(defaultGrade) : null,
    };
    rerender();
  };

  const onStartCreate = (): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: emptyForm(defaultGrade),
      lastCreated: null,
      importState: state.importState,
    };
    rerender();
  };

  const onCancelCreate = (): void => {
    if (state.kind !== "list") return;
    state = {
      kind: "list",
      classes: state.classes,
      form: null,
      lastCreated: state.lastCreated,
      importState: state.importState,
    };
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
            setupForm: emptySetupForm(defaultGrade),
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
    void controller.start();
  };

  const onSelectImportCourse = (course: IntegrationsLmsClass): void => {
    if (importController === null) return;
    void importController.selectCourse(course);
  };

  const onCancelImport = (): void => {
    if (importController === null) {
      if (state.kind === "list") {
        state = {
          kind: "list",
          classes: state.classes,
          form: state.form,
          lastCreated: state.lastCreated,
          importState: idleImportState(),
        };
        rerender();
      }
      return;
    }
    importController.cancel();
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
        if (!mount.isConnected) return;
        // Phase 2B.2: best-effort preference update. Fire-and-forget.
        // A failure here must never surface an error to the teacher and
        // must never undo the successful class creation. The next
        // Manual Create simply falls back to the prior preference (or
        // to no preference).
        if (
          updateDefaultGrade !== null &&
          (grade === "6" || grade === "7" || grade === "8")
        ) {
          const submittedGrade = grade as TeacherDefaultGrade;
          void updateDefaultGrade(submittedGrade).catch(() => {
            // Swallowed by design.
          });
        }
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
      setupForm: tab === "setup" ? (state.setupForm ?? emptySetupForm(defaultGrade)) : null,
    };
    rerender();
  };

  const onBackToList = (): void => {
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
        if (!mount.isConnected) return;
        // Phase 2B.4: best-effort defaultGrade preference update.
        // Activation has already succeeded; a preference failure must
        // never surface an error or block navigation.
        if (updateDefaultGrade !== null) {
          void updateDefaultGrade(submittedGrade).catch(() => {
            // Swallowed by design.
          });
        }
        // Refresh the class list so the newly active class carries its
        // atomic grade / block / joinCode, then navigate to Snapshot.
        void deps
          .listClasses(session.uid)
          .then((classes) => {
            if (!mount.isConnected) return;
            state = {
              kind: "workspace",
              classes,
              selectedId: classId,
              tab: "snapshot",
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
      state = {
        kind: "list",
        classes,
        form: null,
        lastCreated: null,
        importState: idleImportState(),
      };
      rerender();
    })
    .catch(() => {
      if (!mount.isConnected) return;
      state = { kind: "error" };
      rerender();
    });
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
  status.textContent = "We could not load your classrooms.";
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
  canCreate: boolean,
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
): void {
  appendHeadline(doc, mount, "Classes");

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "classes-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  mount.appendChild(status);

  if (canCreate) {
    mount.appendChild(
      renderImportEntryPoint(
        doc,
        canImport,
        importState,
        onStartImport,
        onSelectImportCourse,
        onCancelImport,
        onRetryImport,
        onOpenExistingClass,
      ),
    );
    mount.appendChild(
      renderCreateControls(
        doc,
        form,
        onStartCreate,
        onCancelCreate,
        onFormChange,
        onSubmitCreate,
      ),
    );
  }

  if (lastCreated !== null) {
    mount.appendChild(renderJoinCodePanel(doc, lastCreated, onDismissLastCreated));
  }

  const region = doc.createElement("div");
  region.className = "shell-classes-region";
  region.setAttribute("data-testid", "classes-region");
  mount.appendChild(region);

  if (classes.length === 0) {
    status.textContent = "You do not have any classrooms yet.";
    const empty = doc.createElement("p");
    empty.className = "shell-classes-empty";
    empty.setAttribute("data-testid", "classes-empty");
    empty.textContent = canCreate
      ? "Choose Import Class from Google Classroom to bring in a class you already teach, or Create LyfeLabz Class to add one from scratch."
      : "Classrooms you own will appear here once they are created.";
    region.appendChild(empty);
    return;
  }

  status.textContent =
    classes.length === 1 ? "1 classroom" : `${classes.length} classrooms`;

  const prompt = doc.createElement("p");
  prompt.className = "shell-classes-prompt";
  prompt.setAttribute("data-testid", "classes-prompt");
  prompt.textContent = "Choose a class to open its workspace.";
  region.appendChild(prompt);

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

  const panel = doc.createElement("div");
  panel.className = "shell-classes-import-panel";
  panel.setAttribute("data-testid", "classes-import-panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Import Class from Google Classroom");
  wrapper.appendChild(panel);

  panel.appendChild(renderImportStages(doc, importState));

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

const IMPORT_STAGE_LABEL: Readonly<Record<ImportStage, string>> = Object.freeze(
  {
    connecting: "Sign in to Google Classroom",
    discovering: "Load your courses",
    creating: "Create your LyfeLabz class",
    linking: "Link to Google Classroom",
  },
);

const IMPORT_STAGE_ORDER: readonly ImportStage[] = Object.freeze([
  "connecting",
  "discovering",
  "creating",
  "linking",
]);

function renderImportStages(
  doc: Document,
  importState: ImportState,
): HTMLElement {
  const completed = new Set<ImportStage>();
  let active: ImportStage | null = null;
  switch (importState.kind) {
    case "connecting":
      active = "connecting";
      break;
    case "discovering":
      for (const s of importState.stagesComplete) completed.add(s);
      active = "discovering";
      break;
    case "courses":
      for (const s of importState.stagesComplete) completed.add(s);
      break;
    case "creating":
      for (const s of importState.stagesComplete) completed.add(s);
      completed.add("discovering");
      active = "creating";
      break;
    case "linking":
      for (const s of importState.stagesComplete) completed.add(s);
      completed.add("discovering");
      active = "linking";
      break;
    case "error": {
      if (importState.stage === "connecting") {
        active = "connecting";
      } else if (importState.stage === "discovering") {
        completed.add("connecting");
        active = "discovering";
      } else if (importState.stage === "creating") {
        completed.add("connecting");
        completed.add("discovering");
        active = "creating";
      } else {
        completed.add("connecting");
        completed.add("discovering");
        completed.add("creating");
        active = "linking";
      }
      break;
    }
    case "duplicate":
      completed.add("discovering");
      break;
    default:
      break;
  }
  const ol = doc.createElement("ol");
  ol.className = "shell-classes-import-stages";
  ol.setAttribute("data-testid", "classes-import-stages");
  ol.setAttribute("aria-label", "Import progress");
  for (const stage of IMPORT_STAGE_ORDER) {
    const li = doc.createElement("li");
    li.className = "shell-classes-import-stage";
    li.setAttribute("data-testid", `classes-import-stage-${stage}`);
    let statusWord = "pending";
    if (completed.has(stage)) statusWord = "complete";
    if (active === stage)
      statusWord = importState.kind === "error" ? "failed" : "active";
    li.setAttribute("data-status", statusWord);
    if (statusWord === "active") li.setAttribute("aria-current", "step");
    const label = doc.createElement("span");
    label.className = "shell-classes-import-stage-label";
    label.textContent = IMPORT_STAGE_LABEL[stage];
    li.appendChild(label);
    ol.appendChild(li);
  }
  return ol;
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
  submit.textContent = form.submitting ? "Creating" : "Create LyfeLabz Class";
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
    if (summary.grade.length > 0) {
      const grade = doc.createElement("p");
      grade.className = "shell-class-grade";
      grade.setAttribute("data-testid", `class-grade-${summary.id}`);
      grade.textContent =
        summary.block && summary.block.length > 0
          ? `Grade ${summary.grade} - Block ${summary.block}`
          : `Grade ${summary.grade}`;
      card.appendChild(grade);
    }

    if (summary.joinCode && summary.joinCode.length > 0) {
      const code = doc.createElement("p");
      code.className = "shell-class-joincode";
      code.setAttribute("data-testid", `class-joincode-${summary.id}`);
      const label = doc.createElement("span");
      label.className = "shell-class-joincode-label";
      label.textContent = "Join code: ";
      const value = doc.createElement("span");
      value.className = "shell-class-joincode-value";
      value.textContent = summary.joinCode;
      code.appendChild(label);
      code.appendChild(value);
      card.appendChild(code);
    }
  }

  const statusPill = doc.createElement("span");
  statusPill.className = `shell-class-status shell-class-status-${summary.status}`;
  statusPill.setAttribute("data-testid", `class-status-${summary.id}`);
  statusPill.setAttribute(
    "aria-label",
    `Status: ${STATUS_LABEL[summary.status]}`,
  );
  statusPill.textContent = STATUS_LABEL[summary.status];
  card.appendChild(statusPill);

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
type RosterSyncViewEntry =
  | { readonly status: "idle" }
  | { readonly status: "syncing" }
  | { readonly status: "ok"; readonly counters: SyncRosterCounters; readonly at: number }
  | { readonly status: "error"; readonly kind: SyncRosterError["kind"]; readonly at: number };

type RosterSyncView = {
  readonly available: boolean;
  readonly entry: RosterSyncViewEntry;
  readonly onSyncClick: () => void;
};

function renderClassWorkspaceState(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
  tab: ClassWorkspaceTab,
  preview: SnapshotPreview | null,
  onSelectTab: (tab: ClassWorkspaceTab) => void,
  onBack: () => void,
  setupForm: SetupFormState | null,
  onSetupFormChange: (patch: Partial<SetupFormState>) => void,
  onSubmitSetup: () => void,
  onCancelSetup: () => void,
  canActivate: boolean,
  rosterSync: RosterSyncView,
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
      setupForm ?? emptySetupForm(null),
      onSetupFormChange,
      onSubmitSetup,
      onCancelSetup,
      canActivate,
    );
    return;
  }

  workspace.appendChild(renderClassNavigation(doc, tab, onSelectTab));

  // Sprint 24B Phase 2B.8. Sync roster affordance and summary panel.
  // Rendered only for an active LMS-linked class. Manual classes and
  // needsSetup classes never see this row. The button becomes disabled
  // while a sync is in flight; concurrent clicks are suppressed both by
  // the disabled state and by the surface's runRosterSync guard.
  if (
    summary.status === "active" &&
    summary.isLmsLinked === true &&
    rosterSync.available
  ) {
    workspace.appendChild(renderRosterSyncPanel(doc, rosterSync));
  }

  const surfaceMount = doc.createElement("div");
  surfaceMount.className = `shell-class-surface shell-class-surface-${tab}`;
  surfaceMount.setAttribute("data-testid", "class-surface");
  workspace.appendChild(surfaceMount);

  if (tab === "snapshot") {
    renderSnapshotSurface(surfaceMount, { summary, preview });
  } else if (tab === "roster") {
    renderRosterSurface(doc, surfaceMount, summary);
  }
}

// Sprint 24B Phase 2B.8. Sync roster affordance + summary panel. Aggregate
// counters only; no student names, emails, provider account identifiers,
// or Google identifiers ever appear here or in any log line this panel
// emits (it emits none).
function renderRosterSyncPanel(
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
      status.textContent =
        "Sync brings the latest Google Classroom roster into LyfeLabz.";
      break;
    case "syncing":
      status.textContent = "Synchronizing roster with Google Classroom.";
      break;
    case "ok": {
      const c = rosterSync.entry.counters;
      // Truthful aggregate summary. Zero values are always shown so the
      // teacher can distinguish "no changes" from "not yet synced".
      // Unresolved students are represented separately from added so the
      // teacher never mistakes them for enrolled students.
      const parts: string[] = [];
      parts.push(`Added: ${c.added}`);
      parts.push(`Unchanged: ${c.unchanged}`);
      parts.push(`Withdrawn: ${c.withdrawn}`);
      parts.push(`Unresolved: ${c.unresolved}`);
      status.textContent = `Roster synced. ${parts.join(", ")}.`;
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

// Phase 2B.4: one-screen imported-class setup form. Asks only for
// grade and block. Grade may prefill from the teacher's saved
// defaultGrade preference; block never prefills.
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

  const items: ReadonlyArray<{
    readonly key: ClassWorkspaceTab;
    readonly label: string;
  }> = Object.freeze([
    Object.freeze({ key: "snapshot" as const, label: "Snapshot" }),
    Object.freeze({ key: "roster" as const, label: "Roster" }),
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

function renderRosterSurface(
  doc: Document,
  mount: HTMLElement,
  summary: ClassSummary,
): void {
  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome shell-roster-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = summary.title;
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const purpose = doc.createElement("p");
  purpose.className = "shell-status shell-roster-purpose";
  purpose.setAttribute("data-testid", "roster-purpose");
  purpose.textContent =
    "The class roster is where you will manage this class in detail.";
  mount.appendChild(purpose);

  const foundation = doc.createElement("p");
  foundation.className = "shell-roster-foundation";
  foundation.setAttribute("data-testid", "roster-foundation");
  foundation.textContent =
    "The full class-level workspace will grow into this space as later sprints extend the Teacher Platform. Snapshot remains your between-moments view of this class.";
  mount.appendChild(foundation);
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
