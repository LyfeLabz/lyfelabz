import {
  gradeSyncContextFor,
  type CurrentForFamily,
  type GradeSyncContext,
} from "./grade-sync-context";
import { renderAssignmentSummaryCard } from "../summary/card";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../summary/types";
import type {
  AssignmentDetailMetadata,
  AssignmentDetailMetadataReader,
  AssignmentDetailStudentSelection,
  AssignmentGradePassbackRetryResult,
  AssignmentGradePassbackSeam,
  AssignmentGradePassbackStatus,
  AssignmentLmsPublicationState,
  AssignmentLmsRetrySeam,
  AssignmentStatus,
  AssignmentsPublishCallable,
  AssignmentsReopenCallable,
  AssignmentsUpdateDraftCallable,
} from "./types";
import type { AssignmentRecipientListCallable } from "./roster-wire";
import type {
  AssignmentRecipientCandidatesListCallable,
  AssignmentsRecipientAddCallable,
} from "./late-recipient-wire";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "./attempts-wire";
import { groupRoster } from "./roster";
import {
  compareRosterNames,
  createRosterSortControl,
  DEFAULT_ROSTER_SORT_ORDER,
  formatRosterName,
  type RosterSortOrder,
  type RosterSortPreference,
} from "../../teacherPreferences/rosterSort";
import {
  DISCREPANCY_NOTE_COPY,
  reconcileCounts,
  shouldDisplayDiscrepancyNote,
} from "./reconciliation";
import {
  MIN_QUESTION_SUMMARY_ATTEMPTS,
  aggregatePerQuestion,
  buildQuestionDetail,
  classifyQuestionPerformance,
  groupAttemptCohorts,
  sharedAssessmentRevisionId,
  summarizeRetakeParticipation,
  type AssessmentRevisionContent,
  type AssessmentRevisionContentReader,
  type PerQuestionAggregate,
  type QuestionPerformanceBand,
  type QuestionSummary,
} from "./question-summary";
import { createDetailFetchCache, type DetailFetchCache } from "./fetch-cache";
import type {
  AssignmentDetailClassSwitcher,
  ClassSwitchOption,
} from "./class-switcher";

// Sprint 13B Teacher Assignment Detail surface. A pure DOM builder
// that composes the certified Sprint 13A `renderAssignmentSummaryCard`
// with a small header of already-known assignment metadata (title,
// status, class name). No new backend contract is introduced. No
// student roster. No drill-down. No editing. See
// docs/platform/SPRINT_13B_COMPLETION_REPORT.md for scope.
//
// This module opens no Firestore listener, invokes no firebase API,
// and imports no firebase module. All side effects are injected
// through the deps seam so the entry point can wire whichever real
// implementations are available and tests can inject in-memory fakes.
// A posture test in detail.test.ts asserts the absence of firebase
// imports, callable helpers, snapshot listeners, and browser storage
// APIs in this module and in types.ts.

export type AssignmentDetailDeps = {
  readonly assignmentId: string;
  readonly loadMetadata: AssignmentDetailMetadataReader;
  readonly summaryCallable: AssignmentSummaryCallable;
  readonly onBack?: () => void;
  // Sprint 28.6C: optional Back-control label. Assignment Detail is now
  // reachable from two entry paths. When opened from Curriculum -> Active
  // Assignments the control keeps its certified "Back to Curriculum" label
  // (the default). When opened from Classes -> Class -> Assignments the entry
  // point supplies "Back to class" so the teacher returns naturally to the
  // class-centered workflow. Only the label changes; the return behavior is
  // provided entirely by the injected `onBack`.
  readonly backLabel?: string;
  // Teacher-controlled closing is retired: a published assignment stays
  // available for the lifetime of its class, so a published assignment
  // renders no lifecycle action at all (the server also refuses
  // `assignmentsClose` for a published record). `closed` survives only as
  // a legacy compatibility state.
  //
  // Sprint 13E: optional reopen-assignment seam, the legacy recovery path
  // for an assignment whose stored status is already `closed`. When
  // supplied and the loaded metadata is `closed`, the surface renders a
  // secondary `Reopen assignment` action. Activating the action opens a
  // confirmation dialog and, on confirm, invokes the callable exactly
  // once. On success the header returns to the ordinary published state
  // (no lifecycle action) and `onStatusChange` (when supplied) fires with
  // the updated metadata so the session-scoped registry can be
  // re-registered. When the seam is not supplied, a legacy closed
  // assignment renders the non-interactive `Assignment closed` label.
  readonly reopenCallable?: AssignmentsReopenCallable;
  // Sprint 13G: optional draft-editing seam. When supplied and the loaded
  // metadata is `draft`, the surface renders an `Edit draft` action that
  // opens a lightweight inline editor. Saving invokes the callable
  // exactly once with the changed fields and, on success, updates the
  // header immediately and fires `onStatusChange` so the session-scoped
  // registry re-registers the updated metadata. Cancel closes the editor
  // without invoking the callable. Only draft-editable fields are ever
  // sent through this seam; ownership, class, status, submissions,
  // attempts, sessions, and summaries are never exposed. When the seam
  // is not supplied, the surface renders no edit action and the
  // Sprint 13F draft label remains unchanged.
  readonly updateDraftCallable?: AssignmentsUpdateDraftCallable;
  // Sprint 13H: optional draft-publication seam. When supplied and the
  // loaded metadata is `draft`, the surface renders a `Publish
  // assignment` action alongside the Sprint 13G `Edit draft` action.
  // Activating the action opens a confirmation dialog and, on confirm,
  // invokes the callable exactly once. On success the header status
  // transitions to `Published`, the Draft-only lifecycle controls
  // (`Edit draft`, `Publish assignment`, and the Draft-only summary
  // panel) are removed, the Sprint 13A Assignment Summary card is
  // composed, and `onStatusChange` (when supplied) fires with the
  // updated metadata so the session-scoped registry re-registers.
  // Published, closed, and archived assignments never render the
  // publish action. When the seam is not supplied, the surface renders
  // no publish action; the Sprint 13G / 13F draft affordances remain
  // unchanged.
  readonly publishCallable?: AssignmentsPublishCallable;
  readonly onStatusChange?: (metadata: AssignmentDetailMetadata) => void;
  // Sprint 15 Slice 5: certified recipient enumeration + completed
  // attempts list. When both are supplied, published and closed
  // assignments render a roster grouped into Completed, In Progress,
  // and Not Started beneath the Assignment Summary card.
  readonly recipientListCallable?: AssignmentRecipientListCallable;
  readonly attemptsListForClassCallable?: AttemptsListForClassCallable;
  // Sprint 27 Phase 5: late-recipient affordance seams. When both are
  // supplied, a published assignment shows a compact "Students to add"
  // section beneath the roster ONLY when there is someone to add (and the
  // assignment is not a Previous assignment). It lists the active enrolled
  // students in the frozen class who are not yet recipients
  // (`recipientCandidatesListCallable`) and lets the teacher explicitly add
  // one through the certified append-only `manualAddition` path
  // (`recipientAddCallable`, PDR-029h). Normal late enrollment is reconciled
  // automatically on the server, so this is a repair fallback. Both
  // boundaries are server-mediated: the client asserts nothing about
  // enrollment, never constructs recipient provenance, and never mutates the
  // frozen population directly. When either seam is absent the section is
  // never rendered. Each manual add is one explicit, one-at-a-time gesture.
  readonly recipientCandidatesListCallable?: AssignmentRecipientCandidatesListCallable;
  readonly recipientAddCallable?: AssignmentsRecipientAddCallable;
  // Sprint 15 Slice 6: per-attempt detail seam. When supplied and the
  // completed-attempt count meets the minimum threshold, the surface
  // fetches each representative attempt and renders the per-question
  // factual summary. When absent no per-question panel is rendered.
  readonly attemptGetForTeacherCallable?: AttemptGetForTeacherCallable;
  // Question results analytics: optional read seam for the immutable
  // assessment revision the summarized attempts were scored against. When
  // supplied and every counted attempt shares one revision, the question
  // detail shows that revision's question and answer text. Absent, the
  // detail shows option letters and statistics only.
  readonly assessmentRevisionContentReader?: AssessmentRevisionContentReader;
  // Sprint 25 Phase 3: retry entry point for a Google Classroom
  // publication that did not succeed (blueprint §8). When supplied, the
  // surface renders a single calm publication-status line beneath the
  // header and, unless the publication already succeeded, a teacher-
  // initiated retry control. The seam owns the bounded retry workflow
  // entirely; the surface only reflects state and disables the control
  // while a retry is in flight. Absent for assignments with no recorded
  // publication that did not succeed, so the pre-Phase-3 detail surface is
  // unchanged.
  readonly lmsRetry?: AssignmentLmsRetrySeam;
  // Sprint 30A.2: optional per-student Google Classroom grade-passback
  // retry seam. When supplied, the Completed roster group reads the
  // coarse current status for each student and renders a small inline
  // status line + Retry action ONLY for a student whose sync is
  // `pending`/`syncing`/`failed`; a `synced` or absent status renders
  // nothing extra, so the ordinary case stays uncluttered. Absent for
  // assignments with no grading configured (the reader naturally returns
  // an empty map), so the pre-Sprint-30A.2 roster is unchanged when the
  // seam is not supplied.
  readonly gradePassback?: AssignmentGradePassbackSeam;
  // Student Progress & Assignment Membership Phase A, Slice 3: optional
  // student-navigation seam. When supplied, every roster row's student
  // name (Completed, In Progress, and Not Started alike) becomes a
  // clickable control that invokes this with enough to open that
  // student's Student Detail and let its Back control return to this
  // exact assignment. Independent of `gradePassback`: the name control and
  // the grade-passback status/Retry control are separate sibling elements
  // in each row, so one can never trigger the other. Absent-or-null
  // renders names as plain, non-interactive text (the pre-Slice-3
  // behavior).
  readonly onSelectStudent?: (
    selection: AssignmentDetailStudentSelection,
  ) => void;
  // Sprint 30 roster polish: the teacher's roster sort preference (shared
  // with the Classes Students list). Absent: the default order is used and
  // a change applies to this render only.
  readonly rosterSort?: RosterSortPreference;
  // Same-assignment class selector: optional. When supplied and another
  // eligible class has the same lesson, the class name beneath the title
  // becomes a small disclosure listing those classes; selecting one opens
  // that class's Assignment Detail through the caller's navigation path.
  // Absent, or with no other eligible class, the static class label renders
  // exactly as before.
  readonly classSwitcher?: AssignmentDetailClassSwitcher;
};

const STATUS_LABEL: Readonly<Record<AssignmentStatus, string>> = Object.freeze({
  draft: "Draft",
  published: "Published",
  closed: "Closed",
});

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly metadata: AssignmentDetailMetadata }
  | { readonly kind: "empty" }
  | { readonly kind: "error" };

type ReopenUiState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "error" };

// Sprint 13H: publish UI state. `idle` renders the Publish action;
// `pending` disables it while the callable is in flight; `error`
// surfaces a calm, generic teacher-facing message on failure and leaves
// the draft header in place so the teacher can retry.
type PublishUiState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "error" };

// Sprint 13G: inline draft-editor state. `closed` collapses back to the
// static Draft header; `open` renders the form with the current draft
// state; `pending` disables the form while the callable is in flight;
// `error` surfaces a calm, generic teacher-facing message on failure
// and leaves the form open so the teacher can adjust and retry.
type EditUiState =
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly draftTitle: string;
      readonly draftInstructions: string;
      readonly validation: EditValidation;
    }
  | {
      readonly kind: "pending";
      readonly draftTitle: string;
      readonly draftInstructions: string;
    }
  | {
      readonly kind: "error";
      readonly draftTitle: string;
      readonly draftInstructions: string;
      readonly validation: EditValidation;
    };

type EditValidation =
  | { readonly kind: "ok" }
  | { readonly kind: "titleRequired" };

export function renderAssignmentDetail(
  mount: HTMLElement,
  deps: AssignmentDetailDeps,
): void {
  const doc = mount.ownerDocument;

  const surface = doc.createElement("section");
  surface.className = "shell-card shell-assignment-detail";
  surface.setAttribute("data-testid", "assignment-detail");
  surface.setAttribute("data-assignment-id", deps.assignmentId);
  surface.setAttribute("aria-labelledby", "assignment-detail-headline");

  const headline = doc.createElement("h2");
  headline.id = "assignment-detail-headline";
  headline.className = "shell-assignment-detail-headline";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "assignment-detail-headline");
  headline.textContent = "Assignment";
  surface.appendChild(headline);

  if (deps.onBack !== undefined) {
    const back = doc.createElement("button");
    back.type = "button";
    back.className = "shell-back shell-assignment-detail-back";
    back.setAttribute("data-testid", "assignment-detail-back");
    // Sprint 16 Slice 4 / Sprint 28.6C: the Back control returns to the entry
    // context. The default label is "Back to Curriculum" (the Slice 1 lighter
    // re-mount path); the Classes entry path supplies "Back to class". Visible
    // label and the accessible name agree.
    const backLabel = deps.backLabel ?? "Back to Curriculum";
    back.setAttribute("aria-label", backLabel);
    back.textContent = backLabel;
    back.addEventListener("click", () => {
      deps.onBack?.();
    });
    surface.appendChild(back);
  }

  const body = doc.createElement("div");
  body.className = "shell-assignment-detail-body";
  body.setAttribute("data-testid", "assignment-detail-body");
  surface.appendChild(body);

  mount.appendChild(surface);

  let state: LoadState = { kind: "loading" };
  let loadToken = 0;
  let reopenUi: ReopenUiState = { kind: "idle" };
  let editUi: EditUiState = { kind: "closed" };
  let publishUi: PublishUiState = { kind: "idle" };
  // Sprint 25 Phase 3: publication retry state. `lmsRetryState` is the
  // current calm publication state (null when no retry seam is wired);
  // `lmsRetryUi` is the in-flight submit lock for the retry control.
  let lmsRetryState: AssignmentLmsPublicationState | null =
    deps.lmsRetry?.initialState ?? null;
  let lmsRetryUi: { kind: "idle" | "pending" } = { kind: "idle" };

  // Sprint 28 O5.1: latched "an add just succeeded" signal, consumed by the
  // single post-add rerender so the late-recipient panel can surface a calm,
  // announced "Added to assignment." confirmation. It is reset the moment it
  // is consumed so a later, unrelated rerender (a lifecycle transition, a
  // roster refetch) never re-shows a stale confirmation (blueprint §14 R6).
  // Frozen-recipient semantics are unchanged: this is a presentation-only
  // signal that never mutates the recipient population.
  let lateRecipientJustAdded = false;

  // Sprint 16 Slice 2: one shared per-render fetch cache backs all
  // Detail sub-panels so `assessmentAssignmentSummary` and
  // `assessmentAttemptsListForClass` each resolve to exactly one
  // in-flight request per identity for the lifetime of the current
  // ready render. The cache is replaced (and its entries dropped) on
  // every metadata load and on every successful lifecycle transition
  // so no sub-panel ever observes a snapshot older than the current
  // `state.kind === "ready"` transition.
  let detailCache: DetailFetchCache = createDetailFetchCache();
  const refreshDetailCache = (): void => {
    detailCache = createDetailFetchCache();
  };

  // Sprint 16 Slice 4: focus the assignment title on the first successful
  // `ready` render (and again after a retry that recovers from an error)
  // so a keyboard-only teacher lands inside the surface rather than on
  // Back. Internal panel hydration (roster, question summary, lifecycle
  // rerenders) must not steal focus repeatedly, so a single load-scoped
  // guard latches once the title has been focused for the current load.
  let readyTitleFocused = false;

  // Quiz progress visibility: the detail surface (card and roster share one
  // cached call) opts into per-student progress so the roster can show each
  // student's actual state instead of inferring it.
  const sharedSummaryCallable: AssignmentSummaryCallable = (input) =>
    detailCache.get(`summary:${input.assignmentId}`, () =>
      deps.summaryCallable({
        assignmentId: input.assignmentId,
        includeStudentProgress: true,
      }),
    );
  const sharedAttemptsListCallable: AttemptsListForClassCallable | undefined =
    deps.attemptsListForClassCallable === undefined
      ? undefined
      : (input) =>
          detailCache.get(`attempts:${input.classId}`, () =>
            deps.attemptsListForClassCallable!(input),
          );
  // Sprint 16 Slice 5: extend the shared per-render fetch cache to the
  // recipient enumeration and per-attempt detail callables. Pending-state
  // rerenders (for example a lifecycle click that toggles `pending` before
  // the callable resolves) previously re-issued each of these calls even
  // when the underlying data had not moved. Routing them through the same
  // `detailCache` collapses the duplicate reads while still refetching
  // exactly once after every state transition (metadata reload, close,
  // reopen, publish) because the cache is replaced at each of those seams.
  const sharedRecipientListCallable: AssignmentRecipientListCallable | undefined =
    deps.recipientListCallable === undefined
      ? undefined
      : (input) =>
          detailCache.get(`recipients:${input.assignmentId}`, () =>
            deps.recipientListCallable!(input),
          );
  const sharedAttemptGetCallable: AttemptGetForTeacherCallable | undefined =
    deps.attemptGetForTeacherCallable === undefined
      ? undefined
      : (input) =>
          detailCache.get(`attemptGet:${input.attemptId}`, () =>
            deps.attemptGetForTeacherCallable!(input),
          );
  // Revision documents are immutable, so one read per revision per render
  // cache is enough.
  const sharedRevisionContentReader:
    | AssessmentRevisionContentReader
    | undefined =
    deps.assessmentRevisionContentReader === undefined
      ? undefined
      : (revisionId) =>
          detailCache.get(`revisionContent:${revisionId}`, () =>
            deps.assessmentRevisionContentReader!(revisionId),
          );
  // Sprint 27 Phase 5: route the late-recipient candidate enumeration through
  // the same per-render fetch cache. `refreshDetailCache()` on a successful
  // add drops this entry so the section (and the roster above it) re-fetch
  // exactly once and reflect the newly added recipient.
  const sharedCandidatesListCallable:
    | AssignmentRecipientCandidatesListCallable
    | undefined =
    deps.recipientCandidatesListCallable === undefined
      ? undefined
      : (input) =>
          detailCache.get(`candidates:${input.assignmentId}`, () =>
            deps.recipientCandidatesListCallable!(input),
          );

  // The family's canonical Current (`assignmentsLifecycleState`), resolved
  // at most once per load through the same per-render cache, and shared by
  // the header's Current marker and the roster's grade-sync context. A
  // Retry click still re-reads Current fresh (see renderRosterPanel).
  const currentReader = deps.gradePassback?.currentReader;
  const sharedCurrentForFamily =
    currentReader === undefined
      ? undefined
      : (metadata: AssignmentDetailMetadata): Promise<CurrentForFamily> | null => {
          const classId = metadata.classId ?? "";
          const lessonSlug = metadata.lessonSlug ?? "";
          if (classId.length === 0 || lessonSlug.length === 0) return null;
          return detailCache.get(`current:${classId}:${lessonSlug}`, () =>
            currentReader({ classId, lessonSlug }),
          );
        };

  const rerender = (): void => {
    body.textContent = "";
    // The outlet host is reused when another Assignment Detail replaces this
    // one (for example a class switch), so the mount stays connected; a late
    // response for this replaced surface must not render anything.
    if (!mount.isConnected || !surface.isConnected) return;
    const s: LoadState = state;
    switch (s.kind) {
      case "loading":
        renderLoading(doc, body);
        return;
      case "ready": {
        // Sprint 16 Slice 6: recover focus if the previously active control
        // was removed by the rerender (a confirm dialog whose overlay was
        // just torn down, or a lifecycle button that no longer exists in
        // the new status). Without this recovery, `document.activeElement`
        // stays on `body` and keyboard users lose their place. The initial
        // load-scoped focus latch continues to guard against repeated
        // focus transfers during ordinary sub-panel rerenders where the
        // active control still exists elsewhere in the surface.
        const shouldFocusTitle =
          !readyTitleFocused ||
          doc.activeElement === null ||
          doc.activeElement === doc.body;
        readyTitleFocused = true;
        // Sprint 28 O5.1: consume the latched add-success signal exactly once
        // for this rerender so the confirmation is scoped to the post-add view.
        const justAdded = lateRecipientJustAdded;
        lateRecipientJustAdded = false;
        renderReady(
          doc,
          body,
          s.metadata,
          deps,
          {
            summaryCallable: sharedSummaryCallable,
            attemptsListForClassCallable: sharedAttemptsListCallable,
            recipientListCallable: sharedRecipientListCallable,
            attemptGetForTeacherCallable: sharedAttemptGetCallable,
            revisionContentReader: sharedRevisionContentReader,
            recipientCandidatesListCallable: sharedCandidatesListCallable,
            currentForFamily: sharedCurrentForFamily,
          },
          reopenUi,
          editUi,
          publishUi,
          { state: lmsRetryState, ui: lmsRetryUi, seam: deps.lmsRetry },
          shouldFocusTitle,
          justAdded,
          {
            onLmsRetryRequest: () => {
              void performLmsRetry();
            },
            onReconnectRequest: () => {
              deps.lmsRetry?.onReconnect?.();
            },
            onReopenRequest: () => {
              openReopenConfirmation(s.metadata);
            },
            onEditRequest: () => {
              openEditor(s.metadata);
            },
            onEditTitleInput: (value) => {
              updateEditTitle(value);
            },
            onEditInstructionsInput: (value) => {
              updateEditInstructions(value);
            },
            onEditSave: () => {
              void performEditSave(s.metadata);
            },
            onEditCancel: () => {
              closeEditor();
            },
            onPublishRequest: () => {
              openPublishConfirmation(s.metadata);
            },
            onRecipientAdded: () => {
              // Sprint 27 Phase 5: a successful late-recipient add extends the
              // frozen population by one immutable record. Drop the shared
              // fetch cache and rerender so the roster above and the
              // candidate section below both re-fetch exactly once and reflect
              // the newly assigned student. This reuses the same
              // cache-refresh + rerender seam the lifecycle actions use; no
              // student client state is manipulated and no broad reload runs.
              if (state.kind !== "ready") return;
              // Sprint 28 O5.1: latch the success signal so the single
              // post-add rerender surfaces the announced confirmation.
              lateRecipientJustAdded = true;
              refreshDetailCache();
              rerender();
            },
          },
        );
        return;
      }
      case "empty":
        renderEmpty(doc, body);
        return;
      case "error":
        renderError(doc, body, () => {
          void load();
        });
        return;
    }
  };

  const openReopenConfirmation = (metadata: AssignmentDetailMetadata): void => {
    if (deps.reopenCallable === undefined) return;
    if (metadata.status !== "closed") return;
    const confirmController: ReopenConfirmController = {
      onCancel: () => {
        confirmController.close();
      },
      onConfirm: () => {
        confirmController.close();
        void performReopen(metadata);
      },
      close: () => undefined,
    };
    confirmController.close = renderReopenConfirmDialog(
      doc,
      metadata,
      confirmController,
    );
  };

  const performReopen = async (
    metadata: AssignmentDetailMetadata,
  ): Promise<void> => {
    const callable = deps.reopenCallable;
    if (callable === undefined) return;
    reopenUi = { kind: "pending" };
    rerender();
    try {
      const result = await callable({ assignmentId: metadata.assignmentId });
      if (state.kind !== "ready") return;
      const nextMetadata = Object.freeze({
        ...metadata,
        status: "published" as AssignmentStatus,
      });
      state = { kind: "ready", metadata: nextMetadata };
      reopenUi = { kind: "idle" };
      refreshDetailCache();
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      reopenUi = { kind: "error" };
      rerender();
    }
  };

  const openPublishConfirmation = (
    metadata: AssignmentDetailMetadata,
  ): void => {
    if (deps.publishCallable === undefined) return;
    if (metadata.status !== "draft") return;
    if (editUi.kind !== "closed") return;
    const confirmController: PublishConfirmController = {
      onCancel: () => {
        confirmController.close();
      },
      onConfirm: () => {
        confirmController.close();
        void performPublish(metadata);
      },
      close: () => undefined,
    };
    confirmController.close = renderPublishConfirmDialog(
      doc,
      metadata,
      confirmController,
    );
  };

  const performPublish = async (
    metadata: AssignmentDetailMetadata,
  ): Promise<void> => {
    const callable = deps.publishCallable;
    if (callable === undefined) return;
    publishUi = { kind: "pending" };
    rerender();
    try {
      const result = await callable({ assignmentId: metadata.assignmentId });
      if (state.kind !== "ready") return;
      const nextMetadata = Object.freeze({
        ...metadata,
        status: "published" as AssignmentStatus,
      });
      state = { kind: "ready", metadata: nextMetadata };
      publishUi = { kind: "idle" };
      // Symmetric to performReopen: clear any stale lifecycle-error UI so
      // the Published header never carries a stale error banner.
      reopenUi = { kind: "idle" };
      refreshDetailCache();
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      publishUi = { kind: "error" };
      rerender();
    }
  };

  const openEditor = (metadata: AssignmentDetailMetadata): void => {
    if (deps.updateDraftCallable === undefined) return;
    if (metadata.status !== "draft") return;
    editUi = {
      kind: "open",
      draftTitle: metadata.title,
      draftInstructions: metadata.instructions ?? "",
      validation: { kind: "ok" },
    };
    rerender();
  };

  const closeEditor = (): void => {
    editUi = { kind: "closed" };
    rerender();
  };

  const updateEditTitle = (value: string): void => {
    if (editUi.kind === "open" || editUi.kind === "error") {
      const validation: EditValidation =
        value.trim().length === 0
          ? { kind: "titleRequired" }
          : { kind: "ok" };
      editUi = {
        kind: editUi.kind,
        draftTitle: value,
        draftInstructions: editUi.draftInstructions,
        validation,
      };
    }
  };

  const updateEditInstructions = (value: string): void => {
    if (editUi.kind === "open" || editUi.kind === "error") {
      editUi = {
        kind: editUi.kind,
        draftTitle: editUi.draftTitle,
        draftInstructions: value,
        validation: editUi.validation,
      };
    }
  };

  const performEditSave = async (
    metadata: AssignmentDetailMetadata,
  ): Promise<void> => {
    const callable = deps.updateDraftCallable;
    if (callable === undefined) return;
    if (editUi.kind !== "open" && editUi.kind !== "error") return;
    const trimmedTitle = editUi.draftTitle.trim();
    const trimmedInstructions = editUi.draftInstructions.trim();
    if (trimmedTitle.length === 0) {
      editUi = {
        kind: "open",
        draftTitle: editUi.draftTitle,
        draftInstructions: editUi.draftInstructions,
        validation: { kind: "titleRequired" },
      };
      rerender();
      return;
    }
    editUi = {
      kind: "pending",
      draftTitle: editUi.draftTitle,
      draftInstructions: editUi.draftInstructions,
    };
    rerender();
    try {
      const payload: {
        assignmentId: string;
        title?: string;
        instructions?: string;
      } = { assignmentId: metadata.assignmentId };
      if (trimmedTitle !== metadata.title) payload.title = trimmedTitle;
      // Sprint 13G scope completion: instructions are only sent when the
      // trimmed edit differs from the current stored value. The callable
      // rejects the empty string (its contract requires non-empty when
      // supplied), so clearing instructions through the editor is not
      // supported until the callable admits a canonical clear sentinel.
      const currentInstructions = metadata.instructions ?? "";
      if (
        trimmedInstructions.length > 0 &&
        trimmedInstructions !== currentInstructions
      ) {
        payload.instructions = trimmedInstructions;
      }
      const result = await callable(payload);
      if (state.kind !== "ready") return;
      const nextMetadata = Object.freeze({
        ...metadata,
        title: trimmedTitle,
        ...(trimmedInstructions.length > 0
          ? { instructions: trimmedInstructions }
          : {}),
      });
      state = { kind: "ready", metadata: nextMetadata };
      editUi = { kind: "closed" };
      refreshDetailCache();
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      // editUi was set to `pending` before the callable; on failure we
      // preserve the teacher-entered values verbatim.
      const preservedTitle =
        editUi.kind === "pending" ? editUi.draftTitle : trimmedTitle;
      const preservedInstructions =
        editUi.kind === "pending" ? editUi.draftInstructions : "";
      editUi = {
        kind: "error",
        draftTitle: preservedTitle,
        draftInstructions: preservedInstructions,
        validation: { kind: "ok" },
      };
      rerender();
    }
  };

  // Sprint 25 Phase 3: teacher-initiated publication retry. The seam owns
  // the bounded workflow (fresh nonce, at most one incremental consent, at
  // most one automatic re-issue) and never re-runs the LyfeLabz assignment
  // lifecycle. The control is disabled while the retry is in flight so a
  // repeated click cannot dispatch a concurrent request. A retry that again
  // needs permission stops without looping (handled inside the seam).
  const performLmsRetry = async (): Promise<void> => {
    const seam = deps.lmsRetry;
    if (seam === undefined) return;
    if (lmsRetryUi.kind === "pending") return;
    lmsRetryUi = { kind: "pending" };
    rerender();
    let next: AssignmentLmsPublicationState;
    try {
      next = await seam.retry();
    } catch {
      // The seam normalizes every outcome and does not reject; this is a
      // defensive floor that keeps a retry available on an unexpected throw.
      next = "failed";
    }
    lmsRetryState = next;
    lmsRetryUi = { kind: "idle" };
    rerender();
  };

  const load = async (): Promise<void> => {
    const token = ++loadToken;
    state = { kind: "loading" };
    refreshDetailCache();
    // A load pass (initial mount or a retry after error) is the only
    // point where we intentionally move focus into the surface.
    readyTitleFocused = false;
    rerender();
    try {
      const metadata = await deps.loadMetadata({
        assignmentId: deps.assignmentId,
      });
      if (token !== loadToken) return;
      state =
        metadata === null
          ? { kind: "empty" }
          : { kind: "ready", metadata };
      rerender();
    } catch {
      if (token !== loadToken) return;
      state = { kind: "error" };
      rerender();
    }
  };

  void load();
}

function renderLoading(doc: Document, mount: HTMLElement): void {
  const wrap = doc.createElement("div");
  wrap.className = "shell-assignment-detail-loading";
  wrap.setAttribute("data-testid", "assignment-detail-loading");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");

  const spinner = doc.createElement("span");
  spinner.className = "shell-spinner";
  spinner.setAttribute("data-testid", "assignment-detail-spinner");
  spinner.setAttribute("aria-hidden", "true");
  wrap.appendChild(spinner);

  const label = doc.createElement("span");
  label.className = "shell-assignment-detail-loading-label";
  label.textContent = "Loading assignment";
  wrap.appendChild(label);

  mount.appendChild(wrap);
}

type SharedDetailCallables = {
  readonly summaryCallable: AssignmentSummaryCallable;
  readonly attemptsListForClassCallable: AttemptsListForClassCallable | undefined;
  readonly recipientListCallable: AssignmentRecipientListCallable | undefined;
  readonly attemptGetForTeacherCallable: AttemptGetForTeacherCallable | undefined;
  readonly revisionContentReader: AssessmentRevisionContentReader | undefined;
  readonly recipientCandidatesListCallable:
    | AssignmentRecipientCandidatesListCallable
    | undefined;
  // Cached canonical Current for the viewed assignment's family, or null
  // when it cannot be looked up (no class/lesson). Absent when no Current
  // source is wired.
  readonly currentForFamily:
    | ((metadata: AssignmentDetailMetadata) => Promise<CurrentForFamily> | null)
    | undefined;
};

function renderReady(
  doc: Document,
  mount: HTMLElement,
  metadata: AssignmentDetailMetadata,
  deps: AssignmentDetailDeps,
  shared: SharedDetailCallables,
  reopenUi: ReopenUiState,
  editUi: EditUiState,
  publishUi: PublishUiState,
  lmsRetry: {
    readonly state: AssignmentLmsPublicationState | null;
    readonly ui: { readonly kind: "idle" | "pending" };
    readonly seam: AssignmentLmsRetrySeam | undefined;
  },
  focusTitle: boolean,
  // Sprint 28 O5.1: true only on the single rerender that immediately follows
  // a successful late-recipient add, so the panel shows the announced
  // "Added to assignment." confirmation.
  justAdded: boolean,
  handlers: {
    readonly onLmsRetryRequest: () => void;
    readonly onReconnectRequest: () => void;
    readonly onReopenRequest: () => void;
    readonly onEditRequest: () => void;
    readonly onEditTitleInput: (value: string) => void;
    readonly onEditInstructionsInput: (value: string) => void;
    readonly onEditSave: () => void;
    readonly onEditCancel: () => void;
    readonly onPublishRequest: () => void;
    readonly onRecipientAdded: () => void;
  },
): void {
  // Assignment Overview: one outer card holding the assignment identity,
  // its lifecycle action, and (for published and closed assignments) the
  // Assignment Summary metrics. The header row keeps identity and action in
  // DOM reading order; the summary card is composed beneath it.
  const overview = doc.createElement("div");
  overview.className = "shell-assignment-detail-overview";
  overview.setAttribute("data-testid", "assignment-detail-overview");

  const header = doc.createElement("div");
  header.className = "shell-assignment-detail-header";
  header.setAttribute("data-testid", "assignment-detail-header");

  const identity = doc.createElement("div");
  identity.className = "shell-assignment-detail-identity";
  identity.setAttribute("data-testid", "assignment-detail-identity");
  header.appendChild(identity);

  const title = doc.createElement("h3");
  title.className = "shell-assignment-detail-title";
  title.setAttribute("data-testid", "assignment-detail-title");
  title.tabIndex = -1;
  title.textContent = metadata.title;
  identity.appendChild(title);

  // The class name reads directly beneath the title; the page is already
  // reached through a class context, so no separate "Class" label renders.
  // When another eligible class has the same lesson, the name becomes the
  // class-switcher disclosure in the same position.
  appendClassIdentity(doc, identity, metadata, deps.classSwitcher);

  const meta = doc.createElement("dl");
  meta.className = "shell-assignment-detail-meta";
  meta.setAttribute("data-testid", "assignment-detail-meta");
  // Assignment Detail header hierarchy: the ordinary published assignment
  // does not announce its own state, so no Status pair renders for it. Only
  // an exceptional lifecycle state that changes how the teacher reads the
  // page (Closed, Draft) is shown, plus "Previous assignment" when Current
  // resolution positively names a different assignment. The underlying
  // status and Current resolution are unchanged; this is presentation only.
  if (metadata.status === "published") {
    appendPreviousAssignmentWhenSuperseded(doc, meta, metadata, shared);
  } else {
    const statusPair = appendMetaPair(
      doc,
      meta,
      "status",
      "Status",
      STATUS_LABEL[metadata.status],
      `shell-assignment-detail-status shell-assignment-detail-status-${metadata.status}`,
    );
    statusPair.classList.add("shell-assignment-detail-meta-pair-status");
  }

  identity.appendChild(meta);

  // Sprint 13F: a draft assignment renders a calm non-interactive
  // `Draft assignment` label in place of any lifecycle action. Draft
  // discovery is the persistent behavior introduced by this sprint; no
  // Close or Reopen affordance is available for a draft because
  // publication is out of scope. The label renders whether or not
  // lifecycle seams are wired, so a teacher who reloads into a draft
  // never sees an empty header region.
  if (metadata.status === "draft") {
    const lifecycle = doc.createElement("div");
    lifecycle.className = "shell-assignment-detail-lifecycle";
    lifecycle.setAttribute("data-testid", "assignment-detail-lifecycle");

    if (editUi.kind === "closed") {
      const draftLabel = doc.createElement("p");
      draftLabel.className = "shell-assignment-detail-draft-label";
      draftLabel.setAttribute(
        "data-testid",
        "assignment-detail-draft-label",
      );
      draftLabel.setAttribute("role", "status");
      draftLabel.setAttribute("aria-live", "polite");
      draftLabel.textContent = "Draft assignment";
      lifecycle.appendChild(draftLabel);

      if (deps.updateDraftCallable !== undefined) {
        const editButton = doc.createElement("button");
        editButton.type = "button";
        editButton.className = "shell-btn shell-assignment-detail-edit-action";
        editButton.setAttribute(
          "data-testid",
          "assignment-detail-edit-action",
        );
        editButton.textContent = "Edit draft";
        editButton.addEventListener("click", () => {
          handlers.onEditRequest();
        });
        lifecycle.appendChild(editButton);
      }

      // Sprint 13H: Publish action renders alongside Edit draft when the
      // publish callable is wired. Published, closed, and archived
      // assignments never reach this branch (only `draft` does), so the
      // button is never exposed outside the Draft lifecycle.
      if (deps.publishCallable !== undefined) {
        const publishButton = doc.createElement("button");
        publishButton.type = "button";
        publishButton.className =
          "shell-btn shell-assignment-detail-publish-action";
        publishButton.setAttribute(
          "data-testid",
          "assignment-detail-publish-action",
        );
        publishButton.textContent = "Publish assignment";
        if (publishUi.kind === "pending") {
          publishButton.disabled = true;
          publishButton.setAttribute("aria-busy", "true");
        }
        publishButton.addEventListener("click", () => {
          handlers.onPublishRequest();
        });
        lifecycle.appendChild(publishButton);
      }

      if (publishUi.kind === "error") {
        const err = doc.createElement("p");
        err.className = "shell-assignment-detail-publish-error";
        err.setAttribute("data-testid", "assignment-detail-publish-error");
        err.setAttribute("role", "alert");
        err.textContent =
          "We could not publish this assignment right now. Try again in a moment.";
        lifecycle.appendChild(err);
      }
    } else {
      // The open editor needs the full overview width, not the action slot.
      lifecycle.classList.add("shell-assignment-detail-lifecycle-editing");
      renderDraftEditor(doc, lifecycle, editUi, handlers);
    }

    header.appendChild(lifecycle);
  } else if (metadata.status === "closed") {
    // Legacy compatibility only. A published assignment renders no
    // lifecycle action (teacher-controlled closing is retired), so the
    // header identity fills the row. A record whose stored status is
    // already `closed` keeps its recovery path: Reopen when the seam is
    // wired, otherwise the calm non-interactive closed label.
    const lifecycle = doc.createElement("div");
    lifecycle.className = "shell-assignment-detail-lifecycle";
    lifecycle.setAttribute("data-testid", "assignment-detail-lifecycle");
    if (deps.reopenCallable !== undefined) {
      const reopenButton = doc.createElement("button");
      reopenButton.type = "button";
      reopenButton.className =
        "shell-btn shell-assignment-detail-reopen-action";
      reopenButton.setAttribute(
        "data-testid",
        "assignment-detail-reopen-action",
      );
      reopenButton.textContent = "Reopen assignment";
      if (reopenUi.kind === "pending") {
        reopenButton.disabled = true;
        reopenButton.setAttribute("aria-busy", "true");
      }
      reopenButton.addEventListener("click", () => {
        handlers.onReopenRequest();
      });
      lifecycle.appendChild(reopenButton);
    } else {
      const closedLabel = doc.createElement("p");
      closedLabel.className = "shell-assignment-detail-closed-label";
      closedLabel.setAttribute(
        "data-testid",
        "assignment-detail-closed-label",
      );
      closedLabel.setAttribute("role", "status");
      closedLabel.setAttribute("aria-live", "polite");
      closedLabel.textContent = "Assignment closed";
      lifecycle.appendChild(closedLabel);
    }
    if (reopenUi.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-assignment-detail-reopen-error";
      err.setAttribute("data-testid", "assignment-detail-reopen-error");
      err.setAttribute("role", "alert");
      err.textContent =
        "We could not reopen this assignment right now. Try again in a moment.";
      lifecycle.appendChild(err);
    }
    header.appendChild(lifecycle);
  }

  overview.appendChild(header);
  mount.appendChild(overview);

  // Sprint 25 Phase 3: publication status + retry panel. Rendered only for a
  // published or closed assignment that carries a retry seam (a recorded
  // Google Classroom publication). A draft never publishes, so the panel is
  // absent there. The panel is a calm, provider-neutral status line plus, for
  // any state other than succeeded, a single teacher-initiated retry control.
  if (lmsRetry.seam !== undefined && metadata.status !== "draft") {
    renderLmsPublicationPanel(doc, mount, lmsRetry, handlers);
  }

  if (focusTitle) {
    try {
      title.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  }

  // Sprint 13F reconciliation: a draft assignment has no recipients, no
  // sessions, and no attempts, so the Sprint 13A summary card would only
  // render its own empty / error state. Render a calm informational
  // panel in its place. Published and closed assignments continue to
  // compose the certified Sprint 13A `renderAssignmentSummaryCard`
  // unchanged.
  if (metadata.status === "draft") {
    const panel = doc.createElement("section");
    panel.className =
      "shell-assignment-detail-summary shell-assignment-detail-draft-summary";
    panel.setAttribute(
      "data-testid",
      "assignment-detail-draft-summary",
    );
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.setAttribute(
      "aria-labelledby",
      "assignment-detail-draft-summary-heading",
    );

    const heading = doc.createElement("h3");
    heading.id = "assignment-detail-draft-summary-heading";
    heading.className = "shell-assignment-detail-draft-summary-heading";
    heading.setAttribute(
      "data-testid",
      "assignment-detail-draft-summary-heading",
    );
    heading.textContent = "Assignment results";
    panel.appendChild(heading);

    const body = doc.createElement("p");
    body.className = "shell-assignment-detail-draft-summary-body";
    body.setAttribute(
      "data-testid",
      "assignment-detail-draft-summary-body",
    );
    body.textContent =
      "Assignment results will appear after this draft is published and students begin submitting work.";
    panel.appendChild(body);

    mount.appendChild(panel);

    // A draft has no frozen recipient population, so there is nothing to add
    // and no late-recipient UI renders (the Draft header already explains
    // the state).
    return;
  }

  // The summary metrics live inside the Assignment Overview card, directly
  // beneath the identity row.
  const summaryHost = doc.createElement("div");
  summaryHost.className = "shell-assignment-detail-summary";
  summaryHost.setAttribute("data-testid", "assignment-detail-summary-host");
  overview.appendChild(summaryHost);

  // Attempt 2+ participation reuses the same cached class attempts list the
  // roster and Question results read, so it adds no server call.
  const attemptsForParticipation = shared.attemptsListForClassCallable;
  const participationClassId = metadata.classId ?? "";
  renderAssignmentSummaryCard(summaryHost, {
    callable: shared.summaryCallable,
    assignmentId: metadata.assignmentId,
    attemptParticipation:
      attemptsForParticipation === undefined || participationClassId.length === 0
        ? undefined
        : async () => {
            const list = await attemptsForParticipation({
              classId: participationClassId,
            });
            return summarizeRetakeParticipation(
              list.attempts.filter(
                (a) => a.assignmentId === metadata.assignmentId,
              ),
            );
          },
  });

  // Sprint 15 Slice 5: roster grouping beneath the Summary card. The
  // panel is composed for published and closed only. When the required
  // callable seams are absent it is not rendered so tests exercising
  // the pre-Sprint-15 wiring stay green.
  if (
    shared.recipientListCallable !== undefined &&
    shared.attemptsListForClassCallable !== undefined
  ) {
    const rosterHost = doc.createElement("section");
    rosterHost.className = "shell-assignment-detail-roster";
    rosterHost.setAttribute("data-testid", "assignment-detail-roster-host");
    mount.appendChild(rosterHost);
    // Student Progress & Assignment Membership Phase A, Slice 3: bind the
    // student-navigation callback to this already-loaded assignment's
    // `classId`/`assignmentId` so the roster panel and its rows only need
    // to supply the clicked student's own identity.
    const onSelectStudent =
      deps.onSelectStudent === undefined
        ? undefined
        : (studentId: string, studentDisplayName: string): void => {
            deps.onSelectStudent!({
              classId: metadata.classId ?? "",
              studentId,
              studentDisplayName,
              returnToAssignmentId: metadata.assignmentId,
            });
          };
    void renderRosterPanel(
      rosterHost,
      metadata,
      shared.recipientListCallable,
      shared.attemptsListForClassCallable,
      shared.summaryCallable,
      deps.gradePassback,
      onSelectStudent,
      shared.currentForFamily,
      deps.rosterSort,
    );
  }

  // Sprint 27 Phase 5 late-recipient repair affordance, now shown ONLY when
  // it is actionable. Normal late enrollment is reconciled automatically
  // (enrollment-time reconciliation, plus the launch-time self-heal), so this
  // section is a rare fallback: it renders nothing while candidates load,
  // when there are none, when the candidate read fails, and on a Previous
  // assignment (a manual add there cannot produce a launch). Closed and draft
  // assignments cannot gain recipients (PDR-029j) and render nothing. A
  // comment node marks the section's position so nothing occupies layout
  // until the section has real content.
  if (
    metadata.status === "published" &&
    shared.recipientCandidatesListCallable !== undefined &&
    deps.recipientAddCallable !== undefined
  ) {
    const anchor = doc.createComment("late-recipients");
    mount.appendChild(anchor);
    void mountLateRecipientSection(
      anchor,
      metadata,
      shared.recipientCandidatesListCallable,
      deps.recipientAddCallable,
      shared.currentForFamily,
      handlers.onRecipientAdded,
      justAdded,
    );
  }

  // Sprint 15 Slice 6: per-question factual summary beneath the roster.
  // The threshold check happens after the completed-attempt count is
  // known so no per-attempt fetches are issued below the threshold.
  if (
    shared.attemptsListForClassCallable !== undefined &&
    shared.attemptGetForTeacherCallable !== undefined
  ) {
    const questionHost = doc.createElement("section");
    questionHost.className = "shell-assignment-detail-questions";
    questionHost.setAttribute(
      "data-testid",
      "assignment-detail-questions-host",
    );
    mount.appendChild(questionHost);
    void renderQuestionSummaryPanel(
      questionHost,
      metadata,
      shared.attemptsListForClassCallable,
      shared.attemptGetForTeacherCallable,
      shared.revisionContentReader,
    );
  }
}

async function renderRosterPanel(
  host: HTMLElement,
  metadata: AssignmentDetailMetadata,
  recipientCallable: AssignmentRecipientListCallable,
  attemptsCallable: AttemptsListForClassCallable,
  summaryCallable: AssignmentSummaryCallable,
  gradePassback: AssignmentGradePassbackSeam | undefined,
  onSelectStudent:
    | ((studentId: string, studentDisplayName: string) => void)
    | undefined,
  cachedCurrentForFamily?: (
    metadata: AssignmentDetailMetadata,
  ) => Promise<CurrentForFamily> | null,
  rosterSort?: RosterSortPreference,
): Promise<void> {
  const doc = host.ownerDocument;
  host.textContent = "";

  // Sprint 16 Slice 6: the roster section takes its accessible name from
  // the persistent Roster heading so the landmark survives loading, empty,
  // and error branches without leaning on a hand-composed aria-label.
  const headingId = "assignment-detail-roster-heading";
  host.setAttribute("aria-labelledby", headingId);
  // Roster header row: the heading, and (once the roster has loaded) the
  // shared Sort control beside it on wide screens. Detail-scoped wrapper so
  // the shared control and the Classes Students list are unaffected.
  const rosterHeader = doc.createElement("div");
  rosterHeader.className = "shell-assignment-detail-roster-header";
  rosterHeader.setAttribute("data-testid", "assignment-detail-roster-header");
  host.appendChild(rosterHeader);
  const heading = doc.createElement("h3");
  heading.id = headingId;
  heading.className = "shell-assignment-detail-roster-heading";
  heading.setAttribute("data-testid", "assignment-detail-roster-heading");
  heading.textContent = "Roster";
  rosterHeader.appendChild(heading);

  const loading = doc.createElement("p");
  loading.className = "shell-assignment-detail-roster-loading";
  loading.setAttribute("data-testid", "assignment-detail-roster-loading");
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  loading.textContent = "Loading roster...";
  host.appendChild(loading);

  let recipients: ReadonlyArray<{
    readonly studentId: string;
    readonly studentDisplayName: string;
  }>;
  let completed: ReadonlyArray<CompletedAttemptSummary>;
  let summary: AssignmentSummary;
  try {
    const classId = metadata.classId ?? "";
    if (classId.length === 0) throw new Error("class reference missing");
    const [rRes, aRes, sRes] = await Promise.all([
      recipientCallable({ assignmentId: metadata.assignmentId }),
      attemptsCallable({ classId }),
      summaryCallable({ assignmentId: metadata.assignmentId }),
    ]);
    recipients = rRes.recipients;
    completed = aRes.attempts.filter(
      (a) => a.assignmentId === metadata.assignmentId,
    );
    summary = sRes;
  } catch {
    // Sprint 16 Slice 6: keep the persistent `Roster` heading in place so
    // the section landmark stays announced across the loading -> error
    // transition. Only the loading paragraph is replaced.
    loading.remove();
    const err = doc.createElement("p");
    err.className = "shell-assignment-detail-roster-error";
    err.setAttribute("data-testid", "assignment-detail-roster-error");
    err.setAttribute("role", "alert");
    err.textContent = "Roster temporarily unavailable";
    host.appendChild(err);
    return;
  }

  loading.remove();

  // Sprint 30A.2: best-effort grade-passback status read. A failure here
  // never turns the roster into an error state (the surface simply
  // renders as if no student had a passback record yet, matching the
  // "absent means nothing to show" contract).
  let gradePassbackStatuses: ReadonlyMap<string, AssignmentGradePassbackStatus> =
    new Map();
  if (gradePassback !== undefined) {
    try {
      gradePassbackStatuses = await gradePassback.statusesReader({
        assignmentId: metadata.assignmentId,
      });
    } catch {
      gradePassbackStatuses = new Map();
    }
  }
  // Grade destination is the family's Current: a Retry is operational only
  // when the viewed assignment is that destination (resolved once here and
  // re-checked on every Retry click).
  const resolveGradeSyncContext = async (): Promise<GradeSyncContext> =>
    gradePassback === undefined
      ? "operational"
      : resolveGradeSyncContextFor(gradePassback, metadata);
  // Initial context shares the header's cached Current lookup (one
  // lifecycle call per load); only a Retry click re-reads it fresh.
  const gradeSyncContext =
    gradePassback !== undefined && gradePassbackStatuses.size > 0
      ? await resolveGradeSyncContextFor(gradePassback, metadata, cachedCurrentForFamily)
      : "operational";

  // Sprint 16 Slice 4: a published assignment with zero recipients is
  // a calm empty state, not three empty group headers. The `Roster`
  // heading remains as the stable section landmark.
  if (recipients.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "shell-assignment-detail-roster-empty-recipients";
    empty.setAttribute(
      "data-testid",
      "assignment-detail-roster-empty-recipients",
    );
    empty.setAttribute("role", "status");
    empty.setAttribute("aria-live", "polite");
    empty.textContent = "No students are assigned yet.";
    host.appendChild(empty);
    return;
  }

  // Sprint 30 roster polish: a compact Sort control above the groups. A
  // change persists the teacher's preference and MOVES the existing rows into
  // the new order (group membership never depends on the order), so focus
  // stays on the control, nothing is re-fetched, and any live row state
  // (a grade-sync Retry in flight or its result) is kept.
  const sortOrder: RosterSortOrder = rosterSort?.read() ?? DEFAULT_ROSTER_SORT_ORDER;
  const groupsHost = doc.createElement("div");
  groupsHost.className = "shell-assignment-detail-roster-groups";
  groupsHost.setAttribute("data-testid", "assignment-detail-roster-groups");
  rosterHeader.appendChild(
    createRosterSortControl(doc, "assignment-detail-roster", sortOrder, (next) => {
      rosterSort?.write(next);
      const byName = compareRosterNames(next);
      for (const list of Array.from(
        groupsHost.querySelectorAll<HTMLElement>(".shell-assignment-detail-roster-list"),
      )) {
        const rows = Array.from(list.children) as HTMLElement[];
        rows
          .map((li) => ({
            li,
            studentId: li.getAttribute("data-student-id") ?? "",
            studentDisplayName: li.getAttribute("data-student-name") ?? "",
          }))
          .sort(byName)
          .forEach((row) => {
            presentRosterName(row.li, row.studentDisplayName, next);
            list.appendChild(row.li);
          });
      }
    }),
  );
  host.appendChild(groupsHost);

  const grouping = groupRoster({
    recipients,
    completed: completed.map((c) => ({
      studentId: c.studentId,
      percentage: c.percentage,
      attemptNumber: c.attemptNumber,
      submittedAt: c.submittedAt,
    })),
    progress: summary.studentProgress ?? [],
    sortOrder,
  });

  // Sprint 16 Slice 3: every group header count is anchored to the
  // authoritative `assessmentAssignmentSummary` snapshot. The rendered
  // list within each group may still be shorter (recipient enumeration
  // can lag summary during normal operation); the reconciliation note
  // beneath the roster surfaces that gap calmly rather than silently
  // relabeling either dataset.
  appendRosterGroup(
    doc,
    groupsHost,
    "submitted",
    "Completed",
    summary.completedStudents,
    grouping.submitted,
    true,
    gradePassback === undefined
      ? undefined
      : {
          statuses: gradePassbackStatuses,
          context: gradeSyncContext,
          recheckContext: resolveGradeSyncContext,
          retry: (studentId) =>
            gradePassback.retry({ assignmentId: metadata.assignmentId, studentId }),
        },
    onSelectStudent,
    sortOrder,
  );
  appendRosterGroup(
    doc,
    groupsHost,
    "in-progress",
    "In Progress",
    summary.inProgressStudents,
    grouping.inProgress,
    false,
    undefined,
    onSelectStudent,
    sortOrder,
  );
  appendRosterGroup(
    doc,
    groupsHost,
    "not-started",
    "Not Started",
    summary.notStartedStudents,
    grouping.notStarted,
    false,
    undefined,
    onSelectStudent,
    sortOrder,
  );

  const reconciliation = reconcileCounts({
    summary,
    recipientsCount: recipients.length,
    submittedCount: grouping.submitted.length,
    inProgressCount: grouping.inProgress.length,
  });
  if (shouldDisplayDiscrepancyNote(reconciliation)) {
    const note = doc.createElement("p");
    note.className = "shell-assignment-detail-roster-discrepancy";
    note.setAttribute(
      "data-testid",
      "assignment-detail-roster-discrepancy",
    );
    note.setAttribute("data-discrepancy-kind", reconciliation.kind);
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    note.textContent = DISCREPANCY_NOTE_COPY;
    groupsHost.appendChild(note);
  }
}

// Sprint 27 Phase 5: the teacher-facing late-recipient section ("Students to
// add"). Lists the active enrolled students in the frozen class who are not
// yet recipients of this published assignment and lets the teacher
// explicitly add one through the certified `assignmentsRecipientAdd`
// (`manualAddition`) path.
//
// The section preserves frozen-recipient semantics: it never adds a student
// automatically, never adds in bulk, and never mutates the population from
// the client. Each add is a single, deliberate teacher gesture. On success
// `onAdded` refreshes the surface so the roster above and this list below
// both reflect the newly assigned student; the added student then disappears
// from the candidate list because the server no longer returns them.
//
// A double click or a retry is guarded on the client (the section locks
// while any add is in flight) and is idempotent server-side (`added: false`
// on a repeat), so no duplicate recipient record can be created.
//
// Shown only when actionable. Candidates (and, when wired, the family's
// cached Current) are read BEFORE anything is attached at `anchor`, so the
// page never creates a loading card that then disappears. Zero candidates, a
// failed candidate read (this is a repair fallback behind automatic
// reconciliation; the server keeps its own diagnostics), and a Previous
// assignment (Current is positively a different assignment, so a manual add
// cannot produce a launch) all render nothing. An unresolved, inactive,
// invalid, or failed Current lookup never suppresses the section.
//
// The post-add confirmation ("Added to assignment.") lives in one small
// polite live region that is attached EMPTY at render time on the single
// post-add rerender and filled once the read settles, so it is announced
// even when the final candidate was just added and no section remains.
async function mountLateRecipientSection(
  anchor: Comment,
  metadata: AssignmentDetailMetadata,
  candidatesCallable: AssignmentRecipientCandidatesListCallable,
  addCallable: AssignmentsRecipientAddCallable,
  currentForFamily:
    | ((metadata: AssignmentDetailMetadata) => Promise<CurrentForFamily> | null)
    | undefined,
  onAdded: () => void,
  justAdded: boolean,
): Promise<void> {
  const doc = anchor.ownerDocument;
  const parent = anchor.parentNode;
  if (parent === null) return;

  let confirmation: HTMLElement | null = null;
  if (justAdded) {
    confirmation = doc.createElement("p");
    confirmation.className = "shell-assignment-detail-late-recipients-confirmation";
    confirmation.setAttribute(
      "data-testid",
      "assignment-detail-late-recipients-confirmation",
    );
    confirmation.setAttribute("role", "status");
    confirmation.setAttribute("aria-live", "polite");
    parent.insertBefore(confirmation, anchor);
  }

  const isPreviousAssignment = async (): Promise<boolean> => {
    const pending = currentForFamily?.(metadata) ?? null;
    if (pending === null) return false;
    try {
      const current = await pending;
      return (
        current.resolution === "valid" &&
        current.currentAssignmentId !== null &&
        current.currentAssignmentId !== metadata.assignmentId
      );
    } catch {
      return false;
    }
  };

  let candidates: ReadonlyArray<{
    readonly studentId: string;
    readonly studentDisplayName: string;
  }>;
  let previous: boolean;
  try {
    [candidates, previous] = await Promise.all([
      candidatesCallable({ assignmentId: metadata.assignmentId }).then(
        (res) => res.candidates,
      ),
      isPreviousAssignment(),
    ]);
  } catch {
    candidates = [];
    previous = false;
  }

  // A later rerender replaced this surface while the read was in flight.
  if (!anchor.isConnected) return;

  if (confirmation !== null) {
    confirmation.textContent = "Added to assignment.";
  }
  if (previous || candidates.length === 0) return;

  const host = doc.createElement("section");
  host.className = "shell-assignment-detail-late-recipients";
  host.setAttribute("data-testid", "assignment-detail-late-recipients-host");
  const headingId = "assignment-detail-late-recipients-heading";
  host.setAttribute("aria-labelledby", headingId);
  const heading = doc.createElement("h3");
  heading.id = headingId;
  heading.className = "shell-assignment-detail-late-recipients-heading";
  heading.setAttribute(
    "data-testid",
    "assignment-detail-late-recipients-heading",
  );
  // Same hierarchy as the Roster group headings: a status-style label and a
  // separate plain count (never a pill or filter). Heading text reads
  // "Students to add 2".
  const headingLabel = doc.createElement("span");
  headingLabel.className = "shell-assignment-detail-late-recipients-heading-label";
  headingLabel.textContent = "Students to add";
  heading.appendChild(headingLabel);
  heading.appendChild(doc.createTextNode(" "));
  const headingCount = doc.createElement("span");
  headingCount.className = "shell-assignment-detail-late-recipients-heading-count";
  headingCount.setAttribute(
    "data-testid",
    "assignment-detail-late-recipients-count",
  );
  headingCount.textContent = String(candidates.length);
  heading.appendChild(headingCount);
  host.appendChild(heading);

  // Sprint 28 O5.3: the in-flight "Adding..." announcement. The success
  // confirmation is carried by the separate confirmation region above so it
  // survives the section disappearing; on failure this region is cleared and
  // the error line (role="alert") announces the failure instead, so a screen
  // reader never hears overlapping duplicate announcements.
  const statusRegion = doc.createElement("p");
  statusRegion.className = "shell-assignment-detail-late-recipients-status";
  statusRegion.setAttribute(
    "data-testid",
    "assignment-detail-late-recipients-status",
  );
  statusRegion.setAttribute("role", "status");
  statusRegion.setAttribute("aria-live", "polite");
  host.appendChild(statusRegion);

  // A single calm inline error line, reused across add attempts. It never
  // reveals a Firestore path, a callable name, a student identifier, or any
  // internal error code.
  const actionError = doc.createElement("p");
  actionError.className = "shell-assignment-detail-late-recipients-action-error";
  actionError.setAttribute(
    "data-testid",
    "assignment-detail-late-recipients-action-error",
  );
  actionError.setAttribute("role", "alert");
  actionError.hidden = true;

  // Section-level in-flight lock. Once any add is in flight every Add control
  // is disabled so a second concurrent add cannot start before the surface
  // rerenders. This is the client half of the double-add guard; the server
  // half is the idempotent `assignmentsRecipientAdd`.
  let submitting = false;
  const addButtons: HTMLButtonElement[] = [];

  const list = doc.createElement("ul");
  list.className = "shell-assignment-detail-late-recipients-list";
  list.setAttribute(
    "data-testid",
    "assignment-detail-late-recipients-list",
  );

  for (const candidate of candidates) {
    const row = doc.createElement("li");
    row.className = "shell-assignment-detail-late-recipients-row";
    row.setAttribute(
      "data-testid",
      "assignment-detail-late-recipients-row",
    );
    row.setAttribute("data-student-id", candidate.studentId);

    const name = doc.createElement("span");
    name.className = "shell-assignment-detail-late-recipients-name";
    name.setAttribute(
      "data-testid",
      "assignment-detail-late-recipients-name",
    );
    name.textContent = candidate.studentDisplayName;
    row.appendChild(name);

    const add = doc.createElement("button");
    add.type = "button";
    add.className = "shell-assignment-detail-late-recipients-add";
    add.setAttribute(
      "data-testid",
      "assignment-detail-late-recipients-add",
    );
    add.setAttribute(
      "aria-label",
      `Add ${candidate.studentDisplayName} to this assignment`,
    );
    add.textContent = "Add to assignment";
    add.addEventListener("click", () => {
      if (submitting) return;
      submitting = true;
      actionError.hidden = true;
      for (const b of addButtons) b.disabled = true;
      add.textContent = "Adding...";
      // Sprint 28 O5.3: announce the in-flight state to assistive technology.
      // The button-text change alone is not announced; the live region is.
      statusRegion.textContent = "Adding...";
      void (async () => {
        try {
          await addCallable({
            assignmentId: metadata.assignmentId,
            studentId: candidate.studentId,
          });
          // Success (including the idempotent `added: false` replay): refresh
          // the surface so the roster and candidate list both reflect the new
          // recipient. The rerender tears this panel down and rebuilds it with
          // `justAdded` set, which surfaces the announced confirmation, so no
          // local DOM cleanup is required on the success path.
          onAdded();
        } catch {
          submitting = false;
          for (const b of addButtons) b.disabled = false;
          add.textContent = "Add to assignment";
          // Clear the in-flight announcement so it does not linger; the error
          // line (role="alert") carries the failure announcement instead.
          statusRegion.textContent = "";
          actionError.hidden = false;
          actionError.textContent =
            "We could not add this student. Try again in a moment.";
        }
      })();
    });
    addButtons.push(add);
    row.appendChild(add);

    list.appendChild(row);
  }

  host.appendChild(list);
  host.appendChild(actionError);
  parent.insertBefore(host, anchor);
}

// Sprint 30A.2 - calm, coarse copy for the per-student grade-passback
// status line. Never exposes a raw Google error, a Classroom submission
// id, OAuth details, or internal lease/generation state - only these
// fixed strings ever render.
const GRADE_PASSBACK_STATUS_LINE: Readonly<
  Record<AssignmentGradePassbackStatus, string>
> = Object.freeze({
  pending: "Classroom grade sync pending.",
  syncing: "Syncing to Classroom...",
  synced: "Synced to Classroom.",
  failed: "Classroom sync failed",
});

// A failed record on an assignment that is no longer the grade destination
// (a different assignment is Current): preserved history, not an
// operational failure, so it is muted and never offers Retry.
const HISTORICAL_GRADE_SYNC_FAILED = "Historical Classroom sync failed";

async function resolveGradeSyncContextFor(
  seam: AssignmentGradePassbackSeam,
  metadata: AssignmentDetailMetadata,
  cachedCurrentForFamily?: (
    metadata: AssignmentDetailMetadata,
  ) => Promise<CurrentForFamily> | null,
): Promise<GradeSyncContext> {
  // No Current source wired: the pre-Current behavior (every record is
  // operational for its own assignment).
  const currentReader = seam.currentReader;
  if (currentReader === undefined) return "operational";
  const classId = metadata.classId ?? "";
  const lessonSlug = metadata.lessonSlug ?? "";
  if (classId.length === 0 || lessonSlug.length === 0) return "nonActionable";
  try {
    const current = await (cachedCurrentForFamily?.(metadata) ??
      currentReader({ classId, lessonSlug }));
    return gradeSyncContextFor(metadata.assignmentId, current);
  } catch {
    // Fail closed: never offer an operational action on an unknown state.
    return gradeSyncContextFor(metadata.assignmentId, null);
  }
}

function appendRosterGroup(
  doc: Document,
  host: HTMLElement,
  key: string,
  label: string,
  headerCount: number,
  rows: ReadonlyArray<
    | {
        readonly studentId: string;
        readonly studentDisplayName: string;
        readonly status?: string;
      }
    | {
        readonly studentId: string;
        readonly studentDisplayName: string;
        readonly percentage: number;
        readonly attemptCount: number;
        readonly retakeStatus?: string;
      }
  >,
  showPercentage: boolean,
  gradePassback?: {
    readonly statuses: ReadonlyMap<string, AssignmentGradePassbackStatus>;
    readonly context: GradeSyncContext;
    readonly recheckContext: () => Promise<GradeSyncContext>;
    readonly retry: (
      studentId: string,
    ) => Promise<AssignmentGradePassbackRetryResult>;
  },
  onSelectStudent?: (studentId: string, studentDisplayName: string) => void,
  sortOrder: RosterSortOrder = DEFAULT_ROSTER_SORT_ORDER,
): void {
  const group = doc.createElement("div");
  group.className = `shell-assignment-detail-roster-group shell-assignment-detail-roster-${key}`;
  group.setAttribute("data-testid", `assignment-detail-roster-group-${key}`);
  // The internal `key` (submitted / in-progress / not-started) stays the
  // stable hook for test ids and tint classes; only the visible label uses
  // the page-wide status vocabulary (Completed / In Progress / Not Started).
  // Sprint 16 Slice 6: expose the wrapping div as a labeled group so the
  // heading names the roster group programmatically. The count is part of
  // the heading text, so it is announced as part of the group name.
  const groupHeadingId = `assignment-detail-roster-group-heading-${key}`;
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", groupHeadingId);
  const groupHeading = doc.createElement("h4");
  groupHeading.id = groupHeadingId;
  groupHeading.className = "shell-assignment-detail-roster-group-heading";
  groupHeading.setAttribute(
    "data-testid",
    `assignment-detail-roster-group-heading-${key}`,
  );
  // The status word and its count are separate spans so the count reads as
  // a distinct number (not a pill or filter); the space between them keeps
  // the accessible heading text "Completed 3".
  const groupLabel = doc.createElement("span");
  groupLabel.className = "shell-assignment-detail-roster-group-label";
  groupLabel.textContent = label;
  groupHeading.appendChild(groupLabel);
  groupHeading.appendChild(doc.createTextNode(" "));
  const groupCount = doc.createElement("span");
  groupCount.className = "shell-assignment-detail-roster-group-count";
  groupCount.setAttribute(
    "data-testid",
    `assignment-detail-roster-group-count-${key}`,
  );
  groupCount.textContent = String(headerCount);
  groupHeading.appendChild(groupCount);
  group.appendChild(groupHeading);

  // A zero group is just its compact heading and count: the "0" already says
  // the group is empty, so no explanatory sentence and no empty tinted box.
  // A non-empty group becomes a subtle status-tinted container (supplemental
  // to the visible status word, never the only signal).
  if (rows.length > 0) {
    group.classList.add("shell-assignment-detail-roster-group-tinted");
    const list = doc.createElement("ul");
    list.className = "shell-assignment-detail-roster-list";
    list.setAttribute("role", "list");
    for (const row of rows) {
      const li = doc.createElement("li");
      li.className = "shell-assignment-detail-roster-row";
      li.setAttribute(
        "data-testid",
        `assignment-detail-roster-row-${row.studentId}`,
      );
      li.setAttribute("data-student-id", row.studentId);
      li.setAttribute("data-student-name", row.studentDisplayName);
      // Student Progress & Assignment Membership Phase A, Slice 3: the
      // name is a clickable control (a plain button, styled as text) when
      // a navigation seam is wired; otherwise it stays the pre-Slice-3
      // static span. It is a sibling of the percentage span and the
      // grade-passback status/Retry control below - never their ancestor
      // or descendant - so a click on one can never trigger the other.
      const name = doc.createElement(
        onSelectStudent === undefined ? "span" : "button",
      );
      name.className = "shell-assignment-detail-roster-name";
      if (onSelectStudent !== undefined) {
        const nameBtn = name as HTMLButtonElement;
        nameBtn.type = "button";
        nameBtn.setAttribute(
          "data-testid",
          `assignment-detail-roster-name-${row.studentId}`,
        );
        nameBtn.addEventListener("click", () => {
          onSelectStudent(row.studentId, row.studentDisplayName);
        });
      }
      li.appendChild(name);
      presentRosterName(li, row.studentDisplayName, sortOrder);
      // Roster information hierarchy: the score and attempt count are
      // separate cells (Student | Score | Attempts on wide screens, stacked
      // under the name on narrow ones). The score is unchanged (the
      // representative attempt's percentage); the summary is plain text,
      // not a control. The wrapper keeps both cells addressable as one unit.
      if (
        showPercentage &&
        "percentage" in row &&
        typeof row.percentage === "number"
      ) {
        const summary = doc.createElement("span");
        summary.className = "shell-assignment-detail-roster-summary";
        summary.setAttribute(
          "data-testid",
          `assignment-detail-roster-summary-${row.studentId}`,
        );
        const pct = doc.createElement("span");
        pct.className = "shell-assignment-detail-roster-percentage";
        pct.textContent = `${Math.round(row.percentage * 10) / 10}%`;
        summary.appendChild(pct);
        if ("attemptCount" in row && row.attemptCount > 0) {
          // Score and attempts occupy separate columns, so no visual
          // separator. The space keeps the text run "90% 2 attempts" for
          // assistive technology reading the row as one line.
          summary.appendChild(doc.createTextNode(" "));
          const count = doc.createElement("span");
          count.className = "shell-assignment-detail-roster-attempts";
          count.setAttribute(
            "data-testid",
            `assignment-detail-roster-attempts-${row.studentId}`,
          );
          count.textContent = formatAttemptCount(row.attemptCount);
          summary.appendChild(count);
        }
        li.appendChild(summary);
      }
      // Quiz progress visibility: a Live session's actual answered/total
      // ("In Progress · 4/10"), or a retake beside the unchanged best score.
      const progressText =
        "retakeStatus" in row && typeof row.retakeStatus === "string"
          ? row.retakeStatus
          : "status" in row && typeof row.status === "string"
            ? row.status
            : undefined;
      if (progressText !== undefined) {
        const progress = doc.createElement("span");
        progress.className = "shell-assignment-detail-roster-progress";
        progress.setAttribute(
          "data-testid",
          `assignment-detail-roster-progress-${row.studentId}`,
        );
        progress.textContent = progressText;
        li.appendChild(progress);
      }
      // Sprint 30A.2: render the grade-passback status line + Retry action
      // ONLY when there is something useful to show. A `synced` status
      // and an absent status (never attempted, or an ungraded/legacy
      // assignment) both render nothing extra, so the ordinary row stays
      // uncluttered. Current-aware: Retry only in the operational context;
      // a superseded assignment shows only a muted historical failure.
      const initialStatus = gradePassback?.statuses.get(row.studentId);
      if (
        gradePassback !== undefined &&
        (initialStatus === "pending" ||
          initialStatus === "syncing" ||
          initialStatus === "failed")
      ) {
        if (gradePassback.context === "operational") {
          appendGradePassbackControl(
            doc,
            li,
            row.studentId,
            initialStatus,
            gradePassback.retry,
            gradePassback.recheckContext,
          );
        } else if (gradePassback.context === "superseded") {
          if (initialStatus === "failed") {
            appendHistoricalGradeSyncStatus(doc, li, row.studentId);
          }
        } else {
          appendGradeSyncStatusLine(doc, li, row.studentId, initialStatus);
        }
      }
      list.appendChild(li);
    }
    group.appendChild(list);
  }

  host.appendChild(group);
}

// Sprint 30 roster polish: the row's name follows the teacher's sort mode
// ("Brown, Christopher" in Last name mode). The accessible name carries the
// same visible text. Selection still passes the natural display name.
function presentRosterName(
  li: HTMLElement,
  studentDisplayName: string,
  order: RosterSortOrder,
): void {
  const name = li.querySelector<HTMLElement>(".shell-assignment-detail-roster-name");
  if (name === null) return;
  const shown = formatRosterName(studentDisplayName, order);
  name.textContent = shown;
  if (name.tagName === "BUTTON") {
    name.setAttribute("aria-label", `Open student detail for ${shown}`);
  }
}

function formatAttemptCount(count: number): string {
  return `${count} ${count === 1 ? "attempt" : "attempts"}`;
}

function appendGradeSyncStatusLine(
  doc: Document,
  li: HTMLElement,
  studentId: string,
  initialStatus: AssignmentGradePassbackStatus,
): HTMLElement {
  const status = doc.createElement("span");
  status.className = "shell-assignment-detail-roster-grade-status";
  status.setAttribute(
    "data-testid",
    `assignment-detail-roster-grade-status-${studentId}`,
  );
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = GRADE_PASSBACK_STATUS_LINE[initialStatus];
  li.appendChild(status);
  return status;
}

function markHistorical(status: HTMLElement): void {
  status.classList.add("shell-assignment-detail-roster-grade-status-historical");
  status.setAttribute("data-grade-sync-context", "superseded");
  status.textContent = HISTORICAL_GRADE_SYNC_FAILED;
}

function appendHistoricalGradeSyncStatus(
  doc: Document,
  li: HTMLElement,
  studentId: string,
): void {
  markHistorical(appendGradeSyncStatusLine(doc, li, studentId, "failed"));
}

// Sprint 30A.2 - self-contained per-row grade-passback status + Retry
// control. Owns its own tiny idle/pending lock so a double-click cannot
// issue two concurrent retries for the same student, mirroring the
// idle/pending lock convention `performLmsRetry` already established for
// the assignment-level publication retry. Updates only this row's own
// two elements in place; it never triggers a roster refetch, so a retry
// for one student can never disturb another student's row.
function appendGradePassbackControl(
  doc: Document,
  li: HTMLElement,
  studentId: string,
  initialStatus: AssignmentGradePassbackStatus,
  retry: (studentId: string) => Promise<AssignmentGradePassbackRetryResult>,
  recheckContext: () => Promise<GradeSyncContext>,
): void {
  let locked = false;

  const status = appendGradeSyncStatusLine(doc, li, studentId, initialStatus);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "shell-assignment-detail-roster-grade-retry";
  button.setAttribute(
    "data-testid",
    `assignment-detail-roster-grade-retry-${studentId}`,
  );
  button.textContent = "Retry";
  li.appendChild(button);

  button.addEventListener("click", () => {
    if (locked) return;
    locked = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    // Current may have changed since the roster rendered: confirm this
    // assignment is still the operational destination before retrying. If
    // it is not, the row becomes non-actionable and no Retry is sent.
    void recheckContext()
      .then((context) => {
        if (context === "operational") return true;
        button.remove();
        if (context === "superseded" && initialStatus === "failed") {
          markHistorical(status);
        }
        return false;
      })
      .then((stillOperational) =>
        stillOperational ? retry(studentId) : undefined,
      )
      .then((next) => {
        if (next === undefined) return;
        if (next === "synced" || next === "notApplicable") {
          status.remove();
          button.remove();
          return;
        }
        status.textContent =
          next === "pending"
            ? GRADE_PASSBACK_STATUS_LINE.pending
            : GRADE_PASSBACK_STATUS_LINE.failed;
        locked = false;
        button.disabled = false;
        button.removeAttribute("aria-busy");
      })
      .catch(() => {
        status.textContent = GRADE_PASSBACK_STATUS_LINE.failed;
        locked = false;
        button.disabled = false;
        button.removeAttribute("aria-busy");
      });
  });
}

async function renderQuestionSummaryPanel(
  host: HTMLElement,
  metadata: AssignmentDetailMetadata,
  attemptsCallable: AttemptsListForClassCallable,
  attemptGetCallable: AttemptGetForTeacherCallable,
  revisionContentReader: AssessmentRevisionContentReader | undefined,
): Promise<void> {
  const doc = host.ownerDocument;
  host.textContent = "";

  // Sprint 16 Slice 6: the question-summary section takes its accessible
  // name from the persistent Question results heading so the landmark
  // survives loading, deferred, and error branches.
  const headingId = "assignment-detail-questions-heading";
  host.setAttribute("aria-labelledby", headingId);
  const heading = doc.createElement("h3");
  heading.id = headingId;
  heading.className = "shell-assignment-detail-questions-heading";
  heading.setAttribute("data-testid", "assignment-detail-questions-heading");
  heading.textContent = "Question results";
  host.appendChild(heading);

  // Sprint 16 Slice 4: an accessible loading acknowledgement while the
  // shared attempts-list fetch resolves. Mirrors the roster loading
  // pattern so both sub-panels announce consistently.
  const loading = doc.createElement("p");
  loading.className = "shell-assignment-detail-questions-loading";
  loading.setAttribute("data-testid", "assignment-detail-questions-loading");
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  loading.textContent = "Loading question results...";
  host.appendChild(loading);

  let completed: ReadonlyArray<CompletedAttemptSummary>;
  try {
    const classId = metadata.classId ?? "";
    if (classId.length === 0) throw new Error("class reference missing");
    const list = await attemptsCallable({ classId });
    completed = list.attempts.filter(
      (a) => a.assignmentId === metadata.assignmentId,
    );
  } catch {
    loading.remove();
    return;
  }
  loading.remove();

  // Question results analytics use numbered attempt cohorts, never a
  // best or latest attempt: Attempt N is every student's canonical attempt
  // number N. Attempt 1 is the default. The roster and summary keep their
  // own representative-attempt policy; this panel does not touch it.
  const cohorts = groupAttemptCohorts(completed);
  const ordinals = Array.from(cohorts.keys());
  if (ordinals.length === 0) {
    host.appendChild(createQuestionsDeferred(doc));
    return;
  }

  // One persistent polite status for attempt switches and question
  // selection, so updates are announced even as the cohort body re-renders.
  const announcer = doc.createElement("p");
  announcer.className = "shell-assignment-detail-questions-sr";
  announcer.setAttribute("data-testid", "assignment-detail-question-announcer");
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");

  const cohortHost = doc.createElement("div");
  cohortHost.className = "shell-assignment-detail-questions-cohort";
  cohortHost.setAttribute("data-testid", "assignment-detail-questions-cohort");

  let token = 0;
  const showCohort = async (ordinal: number, announce: boolean): Promise<void> => {
    const mine = ++token;
    cohortHost.textContent = "";
    announcer.textContent = "";
    const members = cohorts.get(ordinal) ?? [];
    if (members.length < MIN_QUESTION_SUMMARY_ATTEMPTS) {
      cohortHost.appendChild(createQuestionsDeferred(doc));
      if (announce) {
        announcer.textContent = `Attempt ${ordinal}: question-level results will appear after more students submit.`;
      }
      return;
    }
    const result = await loadCohortResults(
      members,
      attemptGetCallable,
      revisionContentReader,
    );
    if (mine !== token) return;
    if (result === null) {
      const err = doc.createElement("p");
      err.className = "shell-assignment-detail-questions-error";
      err.setAttribute("data-testid", "assignment-detail-questions-error");
      err.setAttribute("role", "alert");
      err.textContent = "Question results temporarily unavailable";
      cohortHost.appendChild(err);
      return;
    }
    renderQuestionResults(
      cohortHost,
      announcer,
      result.aggregate.questions,
      result.content,
    );
    if (announce) {
      announcer.textContent = `Showing Attempt ${ordinal} results for ${studentsLabel(members.length)}.`;
    }
  };

  const initial = ordinals[0]!;
  // The attempt choice appears only when a student has completed a later
  // attempt; a single-option dropdown is never shown.
  if (ordinals.some((n) => n >= 2)) {
    const controls = doc.createElement("div");
    controls.className = "shell-assignment-detail-questions-attempt";
    const label = doc.createElement("label");
    label.className = "shell-assignment-detail-questions-attempt-label";
    label.htmlFor = QUESTION_ATTEMPT_SELECT_ID;
    label.textContent = "View question results:";
    controls.appendChild(label);
    const select = doc.createElement("select");
    select.id = QUESTION_ATTEMPT_SELECT_ID;
    select.className = "shell-assignment-detail-questions-attempt-select";
    select.setAttribute("data-testid", "assignment-detail-questions-attempt-select");
    select.setAttribute("aria-describedby", QUESTION_ATTEMPT_NOTE_ID);
    for (const n of ordinals) {
      const option = doc.createElement("option");
      option.value = String(n);
      option.textContent = `Attempt ${n}`;
      select.appendChild(option);
    }
    select.value = String(initial);
    select.addEventListener("change", () => {
      const n = Number(select.value);
      if (cohorts.has(n)) void showCohort(n, true);
    });
    controls.appendChild(select);
    host.appendChild(controls);
    const note = doc.createElement("p");
    note.id = QUESTION_ATTEMPT_NOTE_ID;
    note.className = "shell-assignment-detail-questions-attempt-note";
    note.setAttribute("data-testid", "assignment-detail-questions-attempt-note");
    note.textContent = "Results include students who completed the selected attempt.";
    host.appendChild(note);
  }

  host.appendChild(cohortHost);
  host.appendChild(announcer);
  await showCohort(initial, false);
}

const QUESTION_ATTEMPT_SELECT_ID = "assignment-detail-questions-attempt-select";
const QUESTION_ATTEMPT_NOTE_ID = "assignment-detail-questions-attempt-note";

function createQuestionsDeferred(doc: Document): HTMLElement {
  const deferred = doc.createElement("p");
  deferred.className = "shell-assignment-detail-questions-deferred";
  deferred.setAttribute("data-testid", "assignment-detail-questions-deferred");
  deferred.setAttribute("role", "status");
  deferred.setAttribute("aria-live", "polite");
  deferred.textContent =
    "Question-level results will appear after more students submit.";
  return deferred;
}

// Fetch one cohort's attempts and aggregate them. Question text comes only
// from the one immutable revision every attempt in THIS cohort was scored
// against; a cohort spanning revisions (or missing one) shows results
// without text, so text from one revision is never paired with responses
// to another. Null when any attempt cannot be fetched.
async function loadCohortResults(
  members: ReadonlyArray<CompletedAttemptSummary>,
  attemptGetCallable: AttemptGetForTeacherCallable,
  revisionContentReader: AssessmentRevisionContentReader | undefined,
): Promise<{
  readonly aggregate: PerQuestionAggregate;
  readonly content: AssessmentRevisionContent | null;
} | null> {
  let detailed: TeacherVisibleAttempt[];
  try {
    detailed = await Promise.all(
      members.map((m) => attemptGetCallable({ attemptId: m.attemptId })),
    );
  } catch {
    return null;
  }
  const aggregate = aggregatePerQuestion(detailed);
  let content: AssessmentRevisionContent | null = null;
  const revisionId = sharedAssessmentRevisionId(detailed);
  if (revisionContentReader !== undefined && revisionId !== null) {
    try {
      content = await revisionContentReader(revisionId);
    } catch {
      content = null;
    }
  }
  if (content !== null && content.revisionId !== revisionId) content = null;
  return { aggregate, content };
}

const QUESTION_BAND_LABEL: Readonly<Record<QuestionPerformanceBand, string>> = {
  strong: "Strong",
  review: "Review",
  reteach: "Reteach",
};

const QUESTION_DETAIL_ID = "assignment-detail-question-detail";
const QUESTION_DETAIL_HEADING_ID = "assignment-detail-question-detail-heading";

const studentsLabel = (count: number): string =>
  `${count} ${count === 1 ? "student" : "students"}`;

// Question results analytics: a scannable overview grid of compact
// question tiles, plus one detail region beneath it for the selected
// question. Tiles are ordinary toggle buttons (aria-pressed); no question
// is selected initially. Performance bands are supplemental: the
// percentage stays dominant and Review / Reteach carry visible text.
function renderQuestionResults(
  host: HTMLElement,
  announcer: HTMLElement,
  questions: ReadonlyArray<QuestionSummary>,
  content: AssessmentRevisionContent | null,
): void {
  const doc = host.ownerDocument;
  const list = doc.createElement("ol");
  list.className = "shell-assignment-detail-questions-list";
  list.setAttribute("data-testid", "assignment-detail-questions-list");
  host.appendChild(list);

  const detail = doc.createElement("div");
  detail.id = QUESTION_DETAIL_ID;
  detail.className = "shell-assignment-detail-question-detail";
  detail.setAttribute("data-testid", "assignment-detail-question-detail");
  detail.setAttribute("role", "region");
  detail.setAttribute("aria-labelledby", QUESTION_DETAIL_HEADING_ID);
  detail.hidden = true;
  host.appendChild(detail);

  const tiles: HTMLButtonElement[] = [];
  let selected = -1;

  const select = (index: number): void => {
    selected = selected === index ? -1 : index;
    tiles.forEach((tile, i) => {
      tile.setAttribute("aria-pressed", i === selected ? "true" : "false");
    });
    detail.textContent = "";
    if (selected === -1) {
      detail.hidden = true;
      announcer.textContent = "";
      return;
    }
    renderQuestionDetail(detail, selected + 1, questions[selected]!, content);
    detail.hidden = false;
    announcer.textContent = `Showing question ${selected + 1} details below.`;
  };

  questions.forEach((q, index) => {
    const number = index + 1;
    const band = classifyQuestionPerformance(q.correctPercentage);
    const li = doc.createElement("li");
    li.className = "shell-assignment-detail-question";
    const tile = doc.createElement("button");
    tile.type = "button";
    tile.className = `shell-assignment-detail-question-tile shell-assignment-detail-question-${band}`;
    tile.setAttribute("data-testid", `assignment-detail-question-tile-${number}`);
    tile.setAttribute("data-item-id", q.itemId);
    tile.setAttribute("data-band", band);
    tile.setAttribute("aria-pressed", "false");
    tile.setAttribute("aria-controls", QUESTION_DETAIL_ID);

    const head = doc.createElement("span");
    head.className = "shell-assignment-detail-question-tile-head";
    const label = doc.createElement("span");
    label.className = "shell-assignment-detail-question-number";
    label.textContent = `Q${number}`;
    head.appendChild(label);
    // Visible restrained text for the two attention bands; the Strong
    // band stays quiet and is exposed to assistive technology only.
    const status = doc.createElement("span");
    status.className =
      band === "strong"
        ? "shell-assignment-detail-questions-sr"
        : "shell-assignment-detail-question-band";
    status.setAttribute("data-testid", `assignment-detail-question-band-${number}`);
    status.textContent = QUESTION_BAND_LABEL[band];
    head.appendChild(status);
    tile.appendChild(head);

    const rate = doc.createElement("span");
    rate.className = "shell-assignment-detail-question-rate";
    rate.textContent = `${q.correctPercentage}% correct`;
    tile.appendChild(rate);

    const count = doc.createElement("span");
    count.className = "shell-assignment-detail-question-count";
    count.textContent = `${q.correctCount} of ${studentsLabel(q.totalResponses)}`;
    tile.appendChild(count);

    tile.addEventListener("click", () => select(index));
    tiles.push(tile);
    li.appendChild(tile);
    list.appendChild(li);
  });
}

function renderQuestionDetail(
  detail: HTMLElement,
  number: number,
  question: QuestionSummary,
  content: AssessmentRevisionContent | null,
): void {
  const doc = detail.ownerDocument;
  const model = buildQuestionDetail(question, content);

  const heading = doc.createElement("h4");
  heading.id = QUESTION_DETAIL_HEADING_ID;
  heading.className = "shell-assignment-detail-question-detail-heading";
  heading.textContent = `Question ${number}`;
  detail.appendChild(heading);

  const stem = doc.createElement("p");
  stem.setAttribute("data-testid", "assignment-detail-question-stem");
  if (model.stem !== null) {
    stem.className = "shell-assignment-detail-question-stem";
    stem.textContent = model.stem;
  } else {
    stem.className = "shell-assignment-detail-question-stem-unavailable";
    stem.textContent = "Question text is not available for these results.";
  }
  detail.appendChild(stem);

  const rate = doc.createElement("p");
  rate.className = "shell-assignment-detail-question-detail-rate";
  rate.setAttribute("data-testid", "assignment-detail-question-detail-rate");
  rate.textContent = `${question.correctPercentage}% correct (${question.correctCount} of ${studentsLabel(question.totalResponses)})`;
  detail.appendChild(rate);

  const choices = doc.createElement("ul");
  choices.className = "shell-assignment-detail-question-choices";
  choices.setAttribute("aria-label", "Answer choices and responses");
  const addRow = (
    key: string,
    labelText: string,
    choiceText: string | null,
    count: number,
    percentage: number,
    isCorrect: boolean,
  ): void => {
    const li = doc.createElement("li");
    li.className = isCorrect
      ? "shell-assignment-detail-question-choice shell-assignment-detail-question-choice-correct"
      : "shell-assignment-detail-question-choice";
    li.setAttribute("data-testid", `assignment-detail-question-choice-${key}`);

    const text = doc.createElement("span");
    text.className = "shell-assignment-detail-question-choice-text";
    const letter = doc.createElement("span");
    letter.className = "shell-assignment-detail-question-choice-letter";
    letter.textContent = labelText;
    text.appendChild(letter);
    if (choiceText !== null) {
      text.appendChild(doc.createTextNode(` ${choiceText}`));
    }
    if (isCorrect) {
      const mark = doc.createElement("span");
      mark.className = "shell-assignment-detail-question-choice-correct-mark";
      mark.setAttribute("data-testid", "assignment-detail-question-correct-mark");
      const icon = doc.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\u2713 ";
      mark.appendChild(icon);
      mark.appendChild(doc.createTextNode("Correct answer"));
      text.appendChild(mark);
    }
    li.appendChild(text);

    const stat = doc.createElement("span");
    stat.className = "shell-assignment-detail-question-choice-stat";
    stat.textContent = `${percentage}% (${studentsLabel(count)})`;
    li.appendChild(stat);

    const bar = doc.createElement("span");
    bar.className = "shell-assignment-detail-question-choice-bar";
    bar.setAttribute("aria-hidden", "true");
    const fill = doc.createElement("span");
    fill.className = "shell-assignment-detail-question-choice-fill";
    fill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    bar.appendChild(fill);
    li.appendChild(bar);

    choices.appendChild(li);
  };
  for (const choice of model.choices) {
    addRow(
      choice.optionId,
      choice.text === null ? choice.optionId : `${choice.optionId}.`,
      choice.text,
      choice.chosenCount,
      choice.chosenPercentage,
      choice.isCorrect,
    );
  }
  if (model.noAnswerCount > 0) {
    addRow(
      "none",
      "No answer",
      null,
      model.noAnswerCount,
      model.noAnswerPercentage,
      false,
    );
  }
  detail.appendChild(choices);
}

type ReopenConfirmController = {
  onCancel: () => void;
  onConfirm: () => void;
  close: () => void;
};

function renderReopenConfirmDialog(
  doc: Document,
  metadata: AssignmentDetailMetadata,
  controller: ReopenConfirmController,
): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-assignment-reopen-overlay";
  overlay.setAttribute("data-testid", "assignment-detail-reopen-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-assignment-reopen-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "assignment-detail-reopen-title");
  dialog.setAttribute(
    "aria-describedby",
    "assignment-detail-reopen-description",
  );
  dialog.setAttribute("data-testid", "assignment-detail-reopen-dialog");
  dialog.setAttribute("data-assignment-id", metadata.assignmentId);

  const title = doc.createElement("h3");
  title.id = "assignment-detail-reopen-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "assignment-detail-reopen-title");
  title.textContent = "Reopen this assignment?";
  dialog.appendChild(title);

  const description = doc.createElement("p");
  description.id = "assignment-detail-reopen-description";
  description.className = "shell-assign-body";
  description.setAttribute(
    "data-testid",
    "assignment-detail-reopen-description",
  );
  description.textContent =
    "Students will be able to submit new work again. Existing submissions and summaries will remain available.";
  dialog.appendChild(description);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "assignment-detail-reopen-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    controller.onCancel();
  });
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", "assignment-detail-reopen-confirm");
  confirm.textContent = "Reopen assignment";
  confirm.addEventListener("click", () => {
    controller.onConfirm();
  });
  footer.appendChild(confirm);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      controller.onCancel();
    }
  };
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) controller.onCancel();
  });

  try {
    cancel.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
  };
}

type PublishConfirmController = {
  onCancel: () => void;
  onConfirm: () => void;
  close: () => void;
};

function renderPublishConfirmDialog(
  doc: Document,
  metadata: AssignmentDetailMetadata,
  controller: PublishConfirmController,
): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-assignment-publish-overlay";
  overlay.setAttribute("data-testid", "assignment-detail-publish-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-assignment-publish-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "assignment-detail-publish-title");
  dialog.setAttribute(
    "aria-describedby",
    "assignment-detail-publish-description",
  );
  dialog.setAttribute("data-testid", "assignment-detail-publish-dialog");
  dialog.setAttribute("data-assignment-id", metadata.assignmentId);

  const title = doc.createElement("h3");
  title.id = "assignment-detail-publish-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "assignment-detail-publish-title");
  title.textContent = "Publish this assignment?";
  dialog.appendChild(title);

  const description = doc.createElement("p");
  description.id = "assignment-detail-publish-description";
  description.className = "shell-assign-body";
  description.setAttribute(
    "data-testid",
    "assignment-detail-publish-description",
  );
  description.textContent =
    "Students in the frozen recipient list will be able to begin submitting work.";
  dialog.appendChild(description);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "assignment-detail-publish-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    controller.onCancel();
  });
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", "assignment-detail-publish-confirm");
  confirm.textContent = "Publish assignment";
  confirm.addEventListener("click", () => {
    controller.onConfirm();
  });
  footer.appendChild(confirm);

  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      controller.onCancel();
    }
  };
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) controller.onCancel();
  });

  try {
    cancel.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    doc.removeEventListener("keydown", onKey);
  };
}

// Sprint 25 Phase 3: calm, provider-neutral copy for each publication
// state. No provider error code, callable name, OAuth term, token, or
// Google identity is ever rendered (blueprint §10). The Google Classroom
// product display name is the only provider reference, matching the Assign
// dialog confirmation copy.
const LMS_PUBLICATION_LINE: Readonly<
  Record<AssignmentLmsPublicationState, string>
> = Object.freeze({
  succeeded: "Publishing to Google Classroom succeeded.",
  failed: "Publishing to Google Classroom did not succeed.",
  permissionNotGranted:
    "Publishing to Google Classroom needs your permission. You can try again from the assignment.",
  // Sprint 26 Phase 4 (definition §7.E). Same-account recovery guidance,
  // distinct from a generic permission failure. No OAuth term, no account
  // identifier, and no implication that the existing connection was
  // replaced - it was not. The "Try again" control below carries the retry.
  identityMismatch:
    "Publishing to Google Classroom needs the same Google account you first connected. Choose that account and try again.",
  reconnectRequired:
    "Google Classroom needs to be reconnected in Settings. Your assignment was scheduled.",
});

function renderLmsPublicationPanel(
  doc: Document,
  mount: HTMLElement,
  lmsRetry: {
    readonly state: AssignmentLmsPublicationState | null;
    readonly ui: { readonly kind: "idle" | "pending" };
    readonly seam: AssignmentLmsRetrySeam | undefined;
  },
  handlers: {
    readonly onLmsRetryRequest: () => void;
    readonly onReconnectRequest: () => void;
  },
): void {
  const state = lmsRetry.state;
  if (state === null) return;

  const panel = doc.createElement("section");
  panel.className = "shell-assignment-detail-lms";
  panel.setAttribute("data-testid", "assignment-detail-lms");
  panel.setAttribute("data-lms-state", state);
  panel.setAttribute("aria-labelledby", "assignment-detail-lms-heading");

  const heading = doc.createElement("h3");
  heading.id = "assignment-detail-lms-heading";
  heading.className = "shell-assignment-detail-lms-heading";
  heading.setAttribute("data-testid", "assignment-detail-lms-heading");
  heading.textContent = "Google Classroom";
  panel.appendChild(heading);

  const line = doc.createElement("p");
  line.className = "shell-assignment-detail-lms-status";
  line.setAttribute("data-testid", "assignment-detail-lms-status");
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  line.textContent = LMS_PUBLICATION_LINE[state];
  panel.appendChild(line);

  // A succeeded publication offers no retry; the status line stands alone.
  if (state !== "succeeded") {
    const actions = doc.createElement("div");
    actions.className = "shell-assignment-detail-lms-actions";

    // A reconnect-class outcome routes the teacher to the account-level
    // Google Classroom connection management in Settings when that route is
    // wired. The retry control remains available for use after reconnection.
    if (state === "reconnectRequired" && lmsRetry.seam?.onReconnect !== undefined) {
      const reconnect = doc.createElement("button");
      reconnect.type = "button";
      reconnect.className =
        "shell-btn shell-assignment-detail-lms-reconnect";
      reconnect.setAttribute(
        "data-testid",
        "assignment-detail-lms-reconnect",
      );
      reconnect.textContent = "Reconnect in Settings";
      reconnect.addEventListener("click", () => {
        handlers.onReconnectRequest();
      });
      actions.appendChild(reconnect);
    }

    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "shell-btn shell-assignment-detail-lms-retry";
    retry.setAttribute("data-testid", "assignment-detail-lms-retry");
    retry.textContent = "Try again";
    if (lmsRetry.ui.kind === "pending") {
      retry.disabled = true;
      retry.setAttribute("aria-busy", "true");
    }
    retry.addEventListener("click", () => {
      handlers.onLmsRetryRequest();
    });
    actions.appendChild(retry);

    panel.appendChild(actions);
  }

  mount.appendChild(panel);
}

// The static class label, or the class-switcher disclosure when another
// eligible class has the same lesson. The switcher's options come from data
// already in memory; while its class list is still loading, the static label
// renders and is upgraded in place once `ready` settles.
function appendClassIdentity(
  doc: Document,
  identity: HTMLElement,
  metadata: AssignmentDetailMetadata,
  switcher: AssignmentDetailClassSwitcher | undefined,
): void {
  const readOptions = (): ReadonlyArray<ClassSwitchOption> | null => {
    if (switcher === undefined) return [];
    try {
      return switcher.options(metadata);
    } catch {
      return [];
    }
  };
  const options = readOptions();
  if (switcher !== undefined && options !== null && options.length > 0) {
    identity.appendChild(renderClassSwitcher(doc, metadata, options, switcher));
    return;
  }
  const label = doc.createElement("p");
  label.className = "shell-assignment-detail-class";
  label.setAttribute("data-testid", "assignment-detail-class-value");
  label.textContent = metadata.className;
  identity.appendChild(label);
  if (switcher === undefined || options !== null || switcher.ready === undefined) {
    return;
  }
  void switcher.ready.then(
    () => {
      if (!label.isConnected) return;
      const later = readOptions();
      if (later === null || later.length === 0) return;
      label.replaceWith(renderClassSwitcher(doc, metadata, later, switcher));
    },
    () => undefined,
  );
}

function renderClassSwitcher(
  doc: Document,
  metadata: AssignmentDetailMetadata,
  options: ReadonlyArray<ClassSwitchOption>,
  switcher: AssignmentDetailClassSwitcher,
): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "shell-assignment-detail-class-switcher";
  wrap.setAttribute("data-testid", "assignment-detail-class-switcher");

  const listId = "assignment-detail-class-options";
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className =
    "shell-assignment-detail-class shell-assignment-detail-class-toggle";
  toggle.setAttribute("data-testid", "assignment-detail-class-toggle");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", listId);
  // The accessible name starts with the visible class name.
  toggle.setAttribute(
    "aria-label",
    `${metadata.className}. Switch class for this lesson`,
  );
  const name = doc.createElement("span");
  name.className = "shell-assignment-detail-class-name";
  name.setAttribute("data-testid", "assignment-detail-class-value");
  name.textContent = metadata.className;
  toggle.appendChild(name);
  // The chevron is a CSS caret turned by `aria-expanded` (see index.html).
  wrap.appendChild(toggle);

  const list = doc.createElement("ul");
  list.id = listId;
  list.className = "shell-assignment-detail-class-options";
  list.setAttribute("data-testid", "assignment-detail-class-options");
  list.setAttribute("aria-label", "Other classes with this lesson");
  list.hidden = true;
  wrap.appendChild(list);

  const optionButtons: HTMLButtonElement[] = [];
  let pending = false;

  const onOutsideClick = (ev: Event): void => {
    if (!wrap.isConnected) {
      doc.removeEventListener("click", onOutsideClick, true);
      return;
    }
    if (ev.target instanceof Node && wrap.contains(ev.target)) return;
    setOpen(false);
  };

  const setOpen = (open: boolean): void => {
    list.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      doc.addEventListener("click", onOutsideClick, true);
    } else {
      doc.removeEventListener("click", onOutsideClick, true);
    }
  };

  toggle.addEventListener("click", () => {
    setOpen(list.hidden);
  });

  wrap.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || list.hidden) return;
    ev.preventDefault();
    ev.stopPropagation();
    setOpen(false);
    toggle.focus();
  });

  // Tabbing out of the open disclosure closes it.
  wrap.addEventListener("focusout", (ev) => {
    const next = ev.relatedTarget;
    if (next instanceof Node && !wrap.contains(next)) setOpen(false);
  });

  for (const option of options) {
    const item = doc.createElement("li");
    item.className = "shell-assignment-detail-class-option";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "shell-assignment-detail-class-option-button";
    button.setAttribute(
      "data-testid",
      `assignment-detail-class-option-${option.classId}`,
    );
    button.setAttribute(
      "aria-label",
      `Open ${metadata.title} for ${option.className}`,
    );
    button.textContent = option.className;
    button.addEventListener("click", () => {
      if (pending) return;
      pending = true;
      wrap.setAttribute("aria-busy", "true");
      for (const b of optionButtons) b.disabled = true;
      const settle = (): void => {
        pending = false;
        wrap.removeAttribute("aria-busy");
        for (const b of optionButtons) b.disabled = false;
      };
      let result: Promise<void>;
      try {
        result = switcher.select(option, { isActive: () => wrap.isConnected });
      } catch {
        settle();
        return;
      }
      void result.then(settle, settle);
    });
    optionButtons.push(button);
    item.appendChild(button);
    list.appendChild(item);
  }

  return wrap;
}

function appendMetaPair(
  doc: Document,
  parent: HTMLElement,
  key: string,
  label: string,
  value: string,
  valueClass?: string,
): HTMLElement {
  const cell = doc.createElement("div");
  cell.className = "shell-assignment-detail-meta-pair";
  cell.setAttribute("data-testid", `assignment-detail-${key}`);

  const term = doc.createElement("dt");
  term.className = "shell-assignment-detail-meta-label";
  term.textContent = label;
  cell.appendChild(term);

  const val = doc.createElement("dd");
  val.className = valueClass ?? "shell-assignment-detail-meta-value";
  val.setAttribute("data-testid", `assignment-detail-${key}-value`);
  val.textContent = value;
  cell.appendChild(val);

  parent.appendChild(cell);
  return cell;
}

// Informational "Previous assignment" state for a published assignment that
// is no longer the family's Current (an older occurrence, for example one
// reopened after a newer assignment was published). The record is neither
// deleted nor closed; students simply work through the Current occurrence.
// Shown ONLY when the canonical resolution is `valid` AND names a different
// assignment; the valid Current itself, no pointer (legacy, still
// operational), invalid, managed-but-inactive, and an unknown lookup all
// render nothing, so the surface never claims a state it does not know.
// Uses the same cached Current read the roster's grade-sync context shares.
function appendPreviousAssignmentWhenSuperseded(
  doc: Document,
  meta: HTMLElement,
  metadata: AssignmentDetailMetadata,
  shared: SharedDetailCallables,
): void {
  const pending = shared.currentForFamily?.(metadata) ?? null;
  if (pending === null) return;
  void pending.then(
    (current) => {
      if (
        current.resolution !== "valid" ||
        current.currentAssignmentId === null ||
        current.currentAssignmentId === metadata.assignmentId ||
        !meta.isConnected
      ) {
        return;
      }
      const pair = appendMetaPair(
        doc,
        meta,
        "status",
        "Status",
        "Previous assignment",
        "shell-assignment-detail-status shell-assignment-detail-status-previous",
      );
      pair.classList.add("shell-assignment-detail-meta-pair-status");
      pair.setAttribute("data-assignment-state", "previous");
    },
    () => undefined,
  );
}

function renderDraftEditor(
  doc: Document,
  parent: HTMLElement,
  editUi: EditUiState,
  handlers: {
    readonly onEditTitleInput: (value: string) => void;
    readonly onEditInstructionsInput: (value: string) => void;
    readonly onEditSave: () => void;
    readonly onEditCancel: () => void;
  },
): void {
  const draftTitle =
    editUi.kind === "open" || editUi.kind === "pending" || editUi.kind === "error"
      ? editUi.draftTitle
      : "";
  const draftInstructions =
    editUi.kind === "open" || editUi.kind === "pending" || editUi.kind === "error"
      ? editUi.draftInstructions
      : "";
  const validation: EditValidation =
    editUi.kind === "open" || editUi.kind === "error"
      ? editUi.validation
      : { kind: "ok" };
  const pending = editUi.kind === "pending";

  const form = doc.createElement("form");
  form.className = "shell-assignment-detail-editor";
  form.setAttribute("data-testid", "assignment-detail-editor");
  form.setAttribute("aria-label", "Edit draft assignment");
  form.setAttribute("novalidate", "novalidate");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    handlers.onEditSave();
  });

  const field = doc.createElement("div");
  field.className = "shell-assignment-detail-editor-field";

  const label = doc.createElement("label");
  label.className = "shell-assignment-detail-editor-label";
  label.setAttribute("for", "assignment-detail-editor-title");
  label.textContent = "Assignment title";
  field.appendChild(label);

  const input = doc.createElement("input");
  input.type = "text";
  input.id = "assignment-detail-editor-title";
  input.className = "shell-assignment-detail-editor-input";
  input.setAttribute("data-testid", "assignment-detail-editor-title");
  input.value = draftTitle;
  input.maxLength = 200;
  input.required = true;
  input.autocomplete = "off";
  if (pending) {
    input.disabled = true;
  }
  if (validation.kind === "titleRequired") {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute(
      "aria-describedby",
      "assignment-detail-editor-title-error",
    );
  }
  input.addEventListener("input", (ev) => {
    const value = (ev.target as HTMLInputElement).value;
    handlers.onEditTitleInput(value);
  });
  field.appendChild(input);

  if (validation.kind === "titleRequired") {
    const err = doc.createElement("p");
    err.id = "assignment-detail-editor-title-error";
    err.className = "shell-assignment-detail-editor-error";
    err.setAttribute(
      "data-testid",
      "assignment-detail-editor-title-error",
    );
    err.setAttribute("role", "alert");
    err.textContent = "Enter a title before saving.";
    field.appendChild(err);
  }

  form.appendChild(field);

  const instructionsField = doc.createElement("div");
  instructionsField.className = "shell-assignment-detail-editor-field";

  const instructionsLabel = doc.createElement("label");
  instructionsLabel.className = "shell-assignment-detail-editor-label";
  instructionsLabel.setAttribute(
    "for",
    "assignment-detail-editor-instructions",
  );
  instructionsLabel.textContent = "Assignment instructions";
  instructionsField.appendChild(instructionsLabel);

  const instructionsInput = doc.createElement("textarea");
  instructionsInput.id = "assignment-detail-editor-instructions";
  instructionsInput.className =
    "shell-assignment-detail-editor-input shell-assignment-detail-editor-instructions";
  instructionsInput.setAttribute(
    "data-testid",
    "assignment-detail-editor-instructions",
  );
  instructionsInput.value = draftInstructions;
  instructionsInput.maxLength = 4000;
  instructionsInput.rows = 4;
  instructionsInput.autocomplete = "off";
  if (pending) {
    instructionsInput.disabled = true;
  }
  instructionsInput.addEventListener("input", (ev) => {
    const value = (ev.target as HTMLTextAreaElement).value;
    handlers.onEditInstructionsInput(value);
  });
  instructionsField.appendChild(instructionsInput);

  form.appendChild(instructionsField);

  const actions = doc.createElement("div");
  actions.className = "shell-assignment-detail-editor-actions";

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-btn shell-assignment-detail-editor-cancel";
  cancel.setAttribute("data-testid", "assignment-detail-editor-cancel");
  cancel.textContent = "Cancel";
  if (pending) cancel.disabled = true;
  cancel.addEventListener("click", () => {
    handlers.onEditCancel();
  });
  actions.appendChild(cancel);

  const save = doc.createElement("button");
  save.type = "submit";
  save.className = "shell-btn shell-assignment-detail-editor-save";
  save.setAttribute("data-testid", "assignment-detail-editor-save");
  save.textContent = "Save";
  if (pending) {
    save.disabled = true;
    save.setAttribute("aria-busy", "true");
  }
  actions.appendChild(save);

  form.appendChild(actions);

  if (editUi.kind === "error") {
    const errBanner = doc.createElement("p");
    errBanner.className = "shell-assignment-detail-editor-save-error";
    errBanner.setAttribute(
      "data-testid",
      "assignment-detail-editor-save-error",
    );
    errBanner.setAttribute("role", "alert");
    errBanner.textContent =
      "We could not save this draft right now. Try again in a moment.";
    form.appendChild(errBanner);
  }

  parent.appendChild(form);

  try {
    input.focus({ preventScroll: true });
  } catch {
    // ignored
  }
}

function renderEmpty(doc: Document, mount: HTMLElement): void {
  const wrap = doc.createElement("p");
  wrap.className = "shell-assignment-detail-empty";
  wrap.setAttribute("data-testid", "assignment-detail-empty");
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.textContent =
    "We could not find this assignment. Return to your workspace and open the assignment again.";
  mount.appendChild(wrap);
}

function renderError(
  doc: Document,
  mount: HTMLElement,
  onRetry: () => void,
): void {
  const wrap = doc.createElement("div");
  wrap.className = "shell-assignment-detail-error";
  wrap.setAttribute("data-testid", "assignment-detail-error");
  wrap.setAttribute("role", "alert");

  const message = doc.createElement("p");
  message.className = "shell-assignment-detail-error-message";
  message.textContent =
    "We could not load this assignment right now. Try again in a moment.";
  wrap.appendChild(message);

  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "shell-assignment-detail-retry shell-btn";
  retry.setAttribute("data-testid", "assignment-detail-retry");
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    onRetry();
  });
  wrap.appendChild(retry);

  mount.appendChild(wrap);
}
