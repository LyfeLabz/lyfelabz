import { renderAssignmentSummaryCard } from "../summary/card";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../summary/types";
import type {
  AssignmentDetailMetadata,
  AssignmentDetailMetadataReader,
  AssignmentStatus,
  AssignmentsCloseCallable,
  AssignmentsPublishCallable,
  AssignmentsReopenCallable,
  AssignmentsUpdateDraftCallable,
} from "./types";
import type { AssignmentRecipientListCallable } from "./roster-wire";
import type {
  AttemptGetForTeacherCallable,
  AttemptsListForClassCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "./attempts-wire";
import { groupRoster } from "./roster";
import {
  DISCREPANCY_NOTE_COPY,
  reconcileCounts,
  shouldDisplayDiscrepancyNote,
} from "./reconciliation";
import {
  MIN_QUESTION_SUMMARY_ATTEMPTS,
  aggregatePerQuestion,
  type PerQuestionAggregate,
} from "./question-summary";
import { createDetailFetchCache, type DetailFetchCache } from "./fetch-cache";

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
  // Sprint 13D: optional close-assignment lifecycle seam. When supplied
  // and the loaded metadata is `published`, the surface renders a
  // secondary `Close assignment` action that opens a confirmation
  // dialog and, on confirm, invokes the callable exactly once. On
  // success the header status transitions to `Closed`, the action is
  // replaced with a non-interactive `Assignment closed` label, and
  // `onStatusChange` (when supplied) is invoked with the updated
  // metadata so the session-scoped registry can be re-registered. When
  // the seam is not supplied, the surface renders no close action; the
  // remainder of the surface is unchanged.
  readonly closeCallable?: AssignmentsCloseCallable;
  // Sprint 13E: optional reopen-assignment lifecycle seam and inverse
  // of `closeCallable`. When supplied and the loaded metadata is
  // `closed`, the surface renders a secondary `Reopen assignment`
  // action in place of the `Assignment closed` label. Activating the
  // action opens a confirmation dialog and, on confirm, invokes the
  // callable exactly once. On success the header status transitions to
  // `Published`, the action is replaced with the Sprint 13D
  // `Close assignment` action (when `closeCallable` is also supplied),
  // and `onStatusChange` (when supplied) fires with the updated
  // metadata so the session-scoped registry can be re-registered.
  // When the seam is not supplied, the surface renders no reopen
  // action; the Sprint 13D `Assignment closed` label continues to
  // render.
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
  // assignments render a roster grouped into Submitted, In progress,
  // and Not started beneath the Assignment Summary card.
  readonly recipientListCallable?: AssignmentRecipientListCallable;
  readonly attemptsListForClassCallable?: AttemptsListForClassCallable;
  // Sprint 15 Slice 6: per-attempt detail seam. When supplied and the
  // completed-attempt count meets the minimum threshold, the surface
  // fetches each representative attempt and renders the per-question
  // factual summary. When absent no per-question panel is rendered.
  readonly attemptGetForTeacherCallable?: AttemptGetForTeacherCallable;
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

type CloseUiState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
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
    back.className = "shell-assignment-detail-back";
    back.setAttribute("data-testid", "assignment-detail-back");
    // Sprint 16 Slice 4: the Back control always returns to Curriculum
    // (the lighter re-mount path from Slice 1). Visible label and the
    // accessible name agree.
    back.setAttribute("aria-label", "Back to Curriculum");
    back.textContent = "Back to Curriculum";
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
  let closeUi: CloseUiState = { kind: "idle" };
  let reopenUi: ReopenUiState = { kind: "idle" };
  let editUi: EditUiState = { kind: "closed" };
  let publishUi: PublishUiState = { kind: "idle" };

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

  const sharedSummaryCallable: AssignmentSummaryCallable = (input) =>
    detailCache.get(`summary:${input.assignmentId}`, () =>
      deps.summaryCallable(input),
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

  const rerender = (): void => {
    body.textContent = "";
    if (!mount.isConnected) return;
    const s: LoadState = state;
    switch (s.kind) {
      case "loading":
        renderLoading(doc, body);
        return;
      case "ready": {
        const shouldFocusTitle = !readyTitleFocused;
        readyTitleFocused = true;
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
          },
          closeUi,
          reopenUi,
          editUi,
          publishUi,
          shouldFocusTitle,
          {
            onCloseRequest: () => {
              openCloseConfirmation(s.metadata);
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

  const openCloseConfirmation = (metadata: AssignmentDetailMetadata): void => {
    if (deps.closeCallable === undefined) return;
    if (metadata.status !== "published") return;
    const confirmController: CloseConfirmController = {
      onCancel: () => {
        confirmController.close();
      },
      onConfirm: () => {
        confirmController.close();
        void performClose(metadata);
      },
      close: () => undefined,
    };
    confirmController.close = renderCloseConfirmDialog(
      doc,
      metadata,
      confirmController,
    );
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
      // A successful reopen also clears any stale close error surfaced
      // from a previous close attempt on this assignment; the two
      // lifecycle actions never render at the same time, so the close
      // error UI would otherwise be attached to a Published header.
      closeUi = { kind: "idle" };
      refreshDetailCache();
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      reopenUi = { kind: "error" };
      rerender();
    }
  };

  const performClose = async (
    metadata: AssignmentDetailMetadata,
  ): Promise<void> => {
    const callable = deps.closeCallable;
    if (callable === undefined) return;
    closeUi = { kind: "pending" };
    rerender();
    try {
      const result = await callable({ assignmentId: metadata.assignmentId });
      if (state.kind !== "ready") return;
      const nextMetadata = Object.freeze({
        ...metadata,
        status: "closed" as AssignmentStatus,
      });
      state = { kind: "ready", metadata: nextMetadata };
      closeUi = { kind: "idle" };
      // Symmetric to performReopen: clear any stale reopen error so the
      // Closed header never carries a Reopen error banner.
      reopenUi = { kind: "idle" };
      refreshDetailCache();
      rerender();
      deps.onStatusChange?.(nextMetadata);
      void result;
    } catch {
      closeUi = { kind: "error" };
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
      // Symmetric to performClose / performReopen: clear any stale
      // lifecycle-error UI so the Published header never carries a
      // publish error banner.
      closeUi = { kind: "idle" };
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
};

function renderReady(
  doc: Document,
  mount: HTMLElement,
  metadata: AssignmentDetailMetadata,
  deps: AssignmentDetailDeps,
  shared: SharedDetailCallables,
  closeUi: CloseUiState,
  reopenUi: ReopenUiState,
  editUi: EditUiState,
  publishUi: PublishUiState,
  focusTitle: boolean,
  handlers: {
    readonly onCloseRequest: () => void;
    readonly onReopenRequest: () => void;
    readonly onEditRequest: () => void;
    readonly onEditTitleInput: (value: string) => void;
    readonly onEditInstructionsInput: (value: string) => void;
    readonly onEditSave: () => void;
    readonly onEditCancel: () => void;
    readonly onPublishRequest: () => void;
  },
): void {
  const header = doc.createElement("div");
  header.className = "shell-assignment-detail-header";
  header.setAttribute("data-testid", "assignment-detail-header");

  const title = doc.createElement("h3");
  title.className = "shell-assignment-detail-title";
  title.setAttribute("data-testid", "assignment-detail-title");
  title.tabIndex = -1;
  title.textContent = metadata.title;
  header.appendChild(title);

  const meta = doc.createElement("dl");
  meta.className = "shell-assignment-detail-meta";
  meta.setAttribute("data-testid", "assignment-detail-meta");

  appendMetaPair(doc, meta, "class", "Class", metadata.className);
  appendMetaPair(
    doc,
    meta,
    "status",
    "Status",
    STATUS_LABEL[metadata.status],
    `shell-assignment-detail-status shell-assignment-detail-status-${metadata.status}`,
  );

  header.appendChild(meta);

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
      renderDraftEditor(doc, lifecycle, editUi, handlers);
    }

    header.appendChild(lifecycle);
  } else if (
    deps.closeCallable !== undefined ||
    deps.reopenCallable !== undefined
  ) {
    const lifecycle = doc.createElement("div");
    lifecycle.className = "shell-assignment-detail-lifecycle";
    lifecycle.setAttribute("data-testid", "assignment-detail-lifecycle");
    if (metadata.status === "published" && deps.closeCallable !== undefined) {
      const closeButton = doc.createElement("button");
      closeButton.type = "button";
      closeButton.className =
        "shell-btn shell-assignment-detail-close-action";
      closeButton.setAttribute(
        "data-testid",
        "assignment-detail-close-action",
      );
      closeButton.textContent = "Close assignment";
      if (closeUi.kind === "pending") {
        closeButton.disabled = true;
        closeButton.setAttribute("aria-busy", "true");
      }
      closeButton.addEventListener("click", () => {
        handlers.onCloseRequest();
      });
      lifecycle.appendChild(closeButton);
    } else if (
      metadata.status === "closed" &&
      deps.reopenCallable !== undefined
    ) {
      // Sprint 13E: reopen action supersedes the Sprint 13D closed-state
      // label so exactly one lifecycle action is visible.
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
    } else if (metadata.status === "closed") {
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
    if (closeUi.kind === "error") {
      const err = doc.createElement("p");
      err.className = "shell-assignment-detail-close-error";
      err.setAttribute("data-testid", "assignment-detail-close-error");
      err.setAttribute("role", "alert");
      err.textContent =
        "We could not close this assignment right now. Try again in a moment.";
      lifecycle.appendChild(err);
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

  mount.appendChild(header);

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
    return;
  }

  const summaryHost = doc.createElement("div");
  summaryHost.className = "shell-assignment-detail-summary";
  summaryHost.setAttribute("data-testid", "assignment-detail-summary-host");
  mount.appendChild(summaryHost);

  renderAssignmentSummaryCard(summaryHost, {
    callable: shared.summaryCallable,
    assignmentId: metadata.assignmentId,
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
    void renderRosterPanel(
      rosterHost,
      metadata,
      shared.recipientListCallable,
      shared.attemptsListForClassCallable,
      shared.summaryCallable,
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
    );
  }
}

async function renderRosterPanel(
  host: HTMLElement,
  metadata: AssignmentDetailMetadata,
  recipientCallable: AssignmentRecipientListCallable,
  attemptsCallable: AttemptsListForClassCallable,
  summaryCallable: AssignmentSummaryCallable,
): Promise<void> {
  const doc = host.ownerDocument;
  host.textContent = "";

  const heading = doc.createElement("h3");
  heading.className = "shell-assignment-detail-roster-heading";
  heading.setAttribute("data-testid", "assignment-detail-roster-heading");
  heading.textContent = "Roster";
  host.appendChild(heading);

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
    host.textContent = "";
    const err = doc.createElement("p");
    err.className = "shell-assignment-detail-roster-error";
    err.setAttribute("data-testid", "assignment-detail-roster-error");
    err.setAttribute("role", "alert");
    err.textContent = "Roster temporarily unavailable";
    host.appendChild(heading.cloneNode(true));
    host.appendChild(err);
    return;
  }

  loading.remove();

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

  const grouping = groupRoster({
    recipients,
    completed: completed.map((c) => ({
      studentId: c.studentId,
      percentage: c.percentage,
      attemptNumber: c.attemptNumber,
      submittedAt: c.submittedAt,
    })),
    inProgressStudentCount: summary.inProgressStudents,
  });

  // Sprint 16 Slice 3: every group header count is anchored to the
  // authoritative `assessmentAssignmentSummary` snapshot. The rendered
  // list within each group may still be shorter (recipient enumeration
  // can lag summary during normal operation); the reconciliation note
  // beneath the roster surfaces that gap calmly rather than silently
  // relabeling either dataset.
  appendRosterGroup(
    doc,
    host,
    "submitted",
    "Submitted",
    summary.completedStudents,
    grouping.submitted,
    true,
  );
  appendRosterGroup(
    doc,
    host,
    "in-progress",
    "In progress",
    summary.inProgressStudents,
    grouping.inProgress,
    false,
  );
  appendRosterGroup(
    doc,
    host,
    "not-started",
    "Not started",
    summary.notStartedStudents,
    grouping.notStarted,
    false,
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
    host.appendChild(note);
  }
}

function appendRosterGroup(
  doc: Document,
  host: HTMLElement,
  key: string,
  label: string,
  headerCount: number,
  rows: ReadonlyArray<
    | { readonly studentId: string; readonly studentDisplayName: string }
    | {
        readonly studentId: string;
        readonly studentDisplayName: string;
        readonly percentage: number;
      }
  >,
  showPercentage: boolean,
): void {
  const group = doc.createElement("div");
  group.className = `shell-assignment-detail-roster-group shell-assignment-detail-roster-${key}`;
  group.setAttribute("data-testid", `assignment-detail-roster-group-${key}`);
  const groupHeading = doc.createElement("h4");
  groupHeading.className = "shell-assignment-detail-roster-group-heading";
  groupHeading.textContent = `${label} (${headerCount})`;
  group.appendChild(groupHeading);

  if (rows.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "shell-assignment-detail-roster-empty";
    empty.setAttribute(
      "data-testid",
      `assignment-detail-roster-empty-${key}`,
    );
    empty.textContent = "No students in this group.";
    group.appendChild(empty);
  } else {
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
      const name = doc.createElement("span");
      name.className = "shell-assignment-detail-roster-name";
      name.textContent = row.studentDisplayName;
      li.appendChild(name);
      if (
        showPercentage &&
        "percentage" in row &&
        typeof row.percentage === "number"
      ) {
        const pct = doc.createElement("span");
        pct.className = "shell-assignment-detail-roster-percentage";
        pct.textContent = `${Math.round(row.percentage * 10) / 10}%`;
        li.appendChild(pct);
      }
      list.appendChild(li);
    }
    group.appendChild(list);
  }

  host.appendChild(group);
}

async function renderQuestionSummaryPanel(
  host: HTMLElement,
  metadata: AssignmentDetailMetadata,
  attemptsCallable: AttemptsListForClassCallable,
  attemptGetCallable: AttemptGetForTeacherCallable,
): Promise<void> {
  const doc = host.ownerDocument;
  host.textContent = "";

  const heading = doc.createElement("h3");
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

  // Representative attempt per student per PDR-029a: highest percentage,
  // then most recent submission, then highest attemptNumber.
  const repByStudent = new Map<string, CompletedAttemptSummary>();
  for (const attempt of completed) {
    const existing = repByStudent.get(attempt.studentId);
    if (existing === undefined) {
      repByStudent.set(attempt.studentId, attempt);
      continue;
    }
    if (
      attempt.percentage > existing.percentage ||
      (attempt.percentage === existing.percentage &&
        attempt.submittedAt > existing.submittedAt) ||
      (attempt.percentage === existing.percentage &&
        attempt.submittedAt === existing.submittedAt &&
        attempt.attemptNumber > existing.attemptNumber)
    ) {
      repByStudent.set(attempt.studentId, attempt);
    }
  }
  const representative = Array.from(repByStudent.values());

  if (representative.length < MIN_QUESTION_SUMMARY_ATTEMPTS) {
    const deferred = doc.createElement("p");
    deferred.className = "shell-assignment-detail-questions-deferred";
    deferred.setAttribute(
      "data-testid",
      "assignment-detail-questions-deferred",
    );
    deferred.setAttribute("role", "status");
    deferred.setAttribute("aria-live", "polite");
    deferred.textContent =
      "Question-level results will appear after more students submit.";
    host.appendChild(deferred);
    return;
  }

  let detailed: TeacherVisibleAttempt[];
  try {
    detailed = await Promise.all(
      representative.map((r) =>
        attemptGetCallable({ attemptId: r.attemptId }),
      ),
    );
  } catch {
    const err = doc.createElement("p");
    err.className = "shell-assignment-detail-questions-error";
    err.setAttribute("data-testid", "assignment-detail-questions-error");
    err.setAttribute("role", "alert");
    err.textContent = "Question results temporarily unavailable";
    host.appendChild(err);
    return;
  }

  const aggregate: PerQuestionAggregate = aggregatePerQuestion(detailed);
  const list = doc.createElement("ol");
  list.className = "shell-assignment-detail-questions-list";
  list.setAttribute("data-testid", "assignment-detail-questions-list");
  for (const q of aggregate.questions) {
    const li = doc.createElement("li");
    li.className = "shell-assignment-detail-question";
    li.setAttribute("data-testid", `assignment-detail-question-${q.itemId}`);
    const prompt = doc.createElement("p");
    prompt.className = "shell-assignment-detail-question-prompt";
    prompt.textContent = q.itemId;
    li.appendChild(prompt);
    const rate = doc.createElement("p");
    rate.className = "shell-assignment-detail-question-rate";
    rate.textContent = `${q.correctPercentage}% correct (${q.correctCount} of ${q.totalResponses})`;
    li.appendChild(rate);
    const options = doc.createElement("ul");
    options.className = "shell-assignment-detail-question-options";
    for (const opt of q.options) {
      const oli = doc.createElement("li");
      oli.className = "shell-assignment-detail-question-option";
      const marker = opt.optionId === q.correctOptionId ? " (correct)" : "";
      oli.textContent = `${opt.optionId}: ${opt.chosenPercentage}%${marker}`;
      options.appendChild(oli);
    }
    li.appendChild(options);
    list.appendChild(li);
  }
  host.appendChild(list);
}

type CloseConfirmController = {
  onCancel: () => void;
  onConfirm: () => void;
  close: () => void;
};

function renderCloseConfirmDialog(
  doc: Document,
  metadata: AssignmentDetailMetadata,
  controller: CloseConfirmController,
): () => void {
  const overlay = doc.createElement("div");
  overlay.className = "shell-assign-overlay shell-assignment-close-overlay";
  overlay.setAttribute("data-testid", "assignment-detail-close-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "shell-assign-dialog shell-assignment-close-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "assignment-detail-close-title");
  dialog.setAttribute(
    "aria-describedby",
    "assignment-detail-close-description",
  );
  dialog.setAttribute("data-testid", "assignment-detail-close-dialog");
  dialog.setAttribute("data-assignment-id", metadata.assignmentId);

  const title = doc.createElement("h3");
  title.id = "assignment-detail-close-title";
  title.className = "shell-assign-title";
  title.setAttribute("data-testid", "assignment-detail-close-title");
  title.textContent = "Close this assignment?";
  dialog.appendChild(title);

  const description = doc.createElement("p");
  description.id = "assignment-detail-close-description";
  description.className = "shell-assign-body";
  description.setAttribute(
    "data-testid",
    "assignment-detail-close-description",
  );
  description.textContent =
    "Students will no longer be able to submit new work. Existing submissions and summaries will remain available.";
  dialog.appendChild(description);

  const footer = doc.createElement("div");
  footer.className = "shell-assign-footer";
  dialog.appendChild(footer);

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "shell-assign-cancel";
  cancel.setAttribute("data-testid", "assignment-detail-close-cancel");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    controller.onCancel();
  });
  footer.appendChild(cancel);

  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "shell-assign-confirm";
  confirm.setAttribute("data-testid", "assignment-detail-close-confirm");
  confirm.textContent = "Close assignment";
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

function appendMetaPair(
  doc: Document,
  parent: HTMLElement,
  key: string,
  label: string,
  value: string,
  valueClass?: string,
): void {
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
