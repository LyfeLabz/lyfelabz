import {
  TEACHER_UNIT_DESCRIPTION_MAX_LENGTH,
  TEACHER_UNIT_GRADES,
  TEACHER_UNIT_TITLE_MAX_LENGTH,
  type TeacherUnit,
  type TeacherUnitGrade,
} from "../../teacherUnits/types";
import {
  validateUnitDescription,
  validateUnitTitle,
  type CreateBlockedReason,
  type CreateRecoveryEntry,
  type TeacherUnitsController,
  type MembershipCommit,
  type TeacherUnitsViewState,
  type UnitMutationResult,
} from "../../teacherUnits/unitsController";
import {
  filterPlaceableResources,
  getPlaceableResources,
  resolveUnitResources,
  resourceEligibility,
} from "../../teacherUnits/placeableResources";
import type { FlatResource } from "../../curriculum/resourceProjection";
import { FORMAL_RESOURCE_LABEL, type FormalResourceType } from "../../curriculum/curriculumManifest";

// U2.2 - My Units panel inside Curriculum (docs/platform/TEACHER_UNITS.md
// §9.4). DOM only: no Firebase, no browser storage. Everything it shows
// comes from the injected controller, which holds authoritative server
// state and the durable create attempts.
//
// Teacher input is never rebuilt away: the create form and every open unit
// editor are long-lived elements, so typing, focus, and unsaved edits
// survive refreshes, conflicts, and archiving. Regions that are rebuilt
// (recovery list, card actions) restore focus to the same control when it
// still exists. Cards are keyed by unitId and only moved when order
// changes.

const BLOCKED_MESSAGES: Partial<Record<CreateBlockedReason, string>> = Object.freeze({
  storageUnavailable:
    "LyfeLabz couldn't save this request in your browser, so it wasn't sent. Check that this browser allows site data, then try again.",
  pendingAttemptExists:
    "LyfeLabz found conflicting saved information for this request, so it wasn't sent. Reload the page to review your unconfirmed requests.",
  recoveryPending:
    "Resolve the unconfirmed unit requests above before creating another unit.",
  checkRequired: "Choose Check my units first.",
  noSession: "Your sign-in changed. Reload the page and sign in to continue.",
  contextMismatch:
    "This request belongs to a different sign-in or school, so it can't be checked here. Reload the page.",
  replayExpired: "This request is too old to check again safely. Check your units instead.",
  replayRefused: "This request can't be checked again. Check your units instead.",
  schoolContextChanged:
    "Your school changed, so this request can't be checked again here. Reload the page to continue at your current school.",
  newUnitIntentRequired: "Choose Create another unit first.",
});

function gradeLabel(g: TeacherUnitGrade): string {
  return `Grade ${g}`;
}

// Teacher-facing type label, the same labels Curriculum Browse uses.
function resourceTypeLabel(r: FlatResource): string {
  if (r.type === "lesson") return "Lesson";
  return FORMAL_RESOURCE_LABEL[r.type as FormalResourceType] ?? "Resource";
}

type CardView = {
  readonly li: HTMLLIElement;
  unit: TeacherUnit;
  // The server no longer returns this unit (deleted or another school).
  gone: boolean;
  editor: EditorView | null;
  picker: PickerView | null;
  // U2.3: retired-resource removal awaiting explicit confirmation; holds
  // the count the teacher was shown (reset when that count changes).
  confirmRetired: number | null;
  readonly notice: HTMLParagraphElement;
  readonly body: HTMLDivElement;
};

type EditorView = {
  readonly form: HTMLFormElement;
  readonly title: HTMLInputElement;
  readonly description: HTMLTextAreaElement;
  readonly error: HTMLParagraphElement;
  readonly save: HTMLButtonElement;
};

// U2.3 resource picker: one long-lived form per card, so the teacher's
// selection and search survive refreshes and conflicts.
type PickerView = {
  readonly form: HTMLFormElement;
  readonly search: HTMLInputElement;
  readonly options: HTMLUListElement;
  readonly submit: HTMLButtonElement;
  readonly selected: Set<string>;
};

export function renderTeacherUnitsPanel(
  host: HTMLElement,
  controller: TeacherUnitsController,
): { readonly dispose: () => void } {
  const doc = host.ownerDocument;
  let disposed = false;
  let idSeq = 0;
  const uid = (p: string): string => `units-${p}-${++idSeq}`;

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const button = (label: string, variant: "" | "primary" | "danger" = ""): HTMLButtonElement => {
    const b = el("button", `shell-btn${variant ? ` shell-btn-${variant}` : ""}`, label);
    b.type = "button";
    return b;
  };
  const focus = (target: HTMLElement | null): void => {
    if (target === null) return;
    try {
      target.focus({ preventScroll: false });
    } catch {
      // ignored
    }
  };
  // Rebuild `container` and, when focus was inside it, return focus to the
  // control with the same test id (or to `fallback`).
  const rebuildKeepingFocus = (
    container: HTMLElement,
    build: () => void,
    fallback: () => HTMLElement | null,
  ): void => {
    const active = doc.activeElement as HTMLElement | null;
    const inside = active !== null && container.contains(active);
    const tid = inside ? active.getAttribute("data-testid") : null;
    container.textContent = "";
    build();
    if (!inside) return;
    const same = tid ? container.querySelector<HTMLElement>(`[data-testid="${tid}"]`) : null;
    focus(same && !(same as HTMLButtonElement).disabled ? same : fallback());
  };

  const root = el("section", "shell-units");
  root.setAttribute("data-testid", "units-panel");
  root.setAttribute("aria-labelledby", "units-heading");
  host.appendChild(root);

  const heading = el("h3", "shell-units-heading", "My Units");
  heading.id = "units-heading";
  heading.tabIndex = -1;
  root.appendChild(heading);
  root.appendChild(
    el("p", "shell-units-intro", "Create your own units for each grade, then add LyfeLabz resources to them."),
  );

  // Grade selector and archived toggle.
  const toolbar = el("div", "shell-units-toolbar");
  root.appendChild(toolbar);
  const gradeRow = el("div", "shell-filter-row");
  gradeRow.setAttribute("role", "group");
  gradeRow.setAttribute("aria-label", "Unit grade");
  gradeRow.setAttribute("data-testid", "units-grade-row");
  toolbar.appendChild(gradeRow);
  const gradeButtons = new Map<TeacherUnitGrade, HTMLButtonElement>();
  for (const g of TEACHER_UNIT_GRADES) {
    const b = el("button", "shell-filter-pill", gradeLabel(g));
    b.type = "button";
    b.setAttribute("data-testid", `units-grade-${g}`);
    b.addEventListener("click", () => controller.setGrade(g));
    gradeRow.appendChild(b);
    gradeButtons.set(g, b);
  }
  const archivedLabel = el("label", "shell-units-archived-toggle");
  const archivedBox = el("input");
  archivedBox.type = "checkbox";
  archivedBox.setAttribute("data-testid", "units-show-archived");
  archivedBox.addEventListener("change", () => controller.setShowArchived(archivedBox.checked));
  archivedLabel.appendChild(archivedBox);
  archivedLabel.appendChild(doc.createTextNode(" Show archived units"));
  toolbar.appendChild(archivedLabel);

  // One polite live region for confirmations.
  const status = el("p", "shell-units-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("data-testid", "units-status");
  root.appendChild(status);
  // Outcome notices for units whose card is not shown (archived and
  // hidden, refreshed away, or no longer found). A card's own notice is used
  // while the card is attached; an outcome is never written into a detached
  // card. One notice per unit: a later outcome for the same unit replaces
  // it, other units' notices are never touched, and each can be dismissed.
  // The panel is torn down on any teacher or school change, so notices
  // never carry across accounts or schools.
  const outcomes = el("div", "shell-units-outcomes");
  outcomes.setAttribute("data-testid", "units-outcomes");
  root.appendChild(outcomes);
  const outcomeNotices = new Map<string, HTMLElement>();
  const clearOutcome = (unitId: string): void => {
    outcomeNotices.get(unitId)?.remove();
    outcomeNotices.delete(unitId);
  };
  const setOutcome = (unitId: string, title: string, msg: string, kind: "conflict" | "error"): void => {
    clearOutcome(unitId);
    const box = el("div", `shell-units-notice shell-units-notice--${kind}`);
    box.setAttribute("role", "alert");
    box.setAttribute("data-testid", `units-outcome-${unitId}`);
    box.appendChild(el("p", "", `"${title}": ${msg}`));
    const dismiss = button("Dismiss");
    dismiss.setAttribute("data-testid", `units-outcome-dismiss-${unitId}`);
    dismiss.setAttribute("aria-label", `Dismiss notice about ${title}`);
    dismiss.addEventListener("click", () => {
      clearOutcome(unitId);
      focus(heading);
    });
    box.appendChild(dismiss);
    outcomes.appendChild(box);
    outcomeNotices.set(unitId, box);
  };
  // Which pending membership request owns the current message (0: none).
  let statusOwner = 0;
  const announce = (msg: string): void => {
    statusOwner = 0;
    status.textContent = "";
    status.textContent = msg;
  };

  // ---------- Create ----------
  const createSection = el("div", "shell-units-create");
  createSection.setAttribute("data-testid", "units-create");
  root.appendChild(createSection);

  const recovery = el("div", "shell-units-recovery");
  recovery.setAttribute("data-testid", "units-recovery");
  recovery.setAttribute("role", "region");
  recovery.setAttribute("aria-label", "Unconfirmed unit requests");
  recovery.hidden = true;
  createSection.appendChild(recovery);

  // Read-only notices for this teacher's unconfirmed requests from a
  // previous school (saved in this browser). Informational only: no
  // controls, because this school's sign-in can't confirm or resend them.
  const former = el("div", "shell-units-recovery shell-units-former");
  former.setAttribute("data-testid", "units-former-school");
  former.setAttribute("role", "region");
  former.setAttribute("aria-labelledby", "units-former-heading");
  former.hidden = true;
  createSection.appendChild(former);

  const createForm = el("form", "shell-units-form");
  createForm.setAttribute("data-testid", "units-create-form");
  createForm.noValidate = true;
  createSection.appendChild(createForm);
  createForm.appendChild(el("h4", "shell-units-subheading", "New unit"));

  const field = (
    labelText: string,
    control: HTMLInputElement | HTMLTextAreaElement,
    testid: string,
  ): HTMLLabelElement => {
    const label = el("label", "shell-units-field");
    const id = uid(testid);
    control.id = id;
    label.htmlFor = id;
    label.appendChild(el("span", "shell-units-field-label", labelText));
    control.setAttribute("data-testid", testid);
    label.appendChild(control);
    return label;
  };

  const createTitle = el("input", "shell-units-input");
  createTitle.type = "text";
  createTitle.maxLength = TEACHER_UNIT_TITLE_MAX_LENGTH;
  createTitle.autocomplete = "off";
  createForm.appendChild(field("Unit name", createTitle, "units-create-title"));
  const createDescription = el("textarea", "shell-units-input shell-units-textarea");
  createDescription.rows = 3;
  createDescription.maxLength = TEACHER_UNIT_DESCRIPTION_MAX_LENGTH;
  createForm.appendChild(field("Description (optional)", createDescription, "units-create-description"));
  const createError = el("p", "shell-units-error");
  createError.setAttribute("role", "alert");
  createError.setAttribute("data-testid", "units-create-error");
  createError.hidden = true;
  createForm.appendChild(createError);
  const createActions = el("div", "shell-units-actions");
  createForm.appendChild(createActions);
  const createSubmit = button("Create unit", "primary");
  createSubmit.type = "submit";
  createSubmit.setAttribute("data-testid", "units-create-submit");
  createActions.appendChild(createSubmit);

  // Long-lived confirmation box; its button receives focus after a create.
  const createdBox = el("div", "shell-units-created");
  createdBox.setAttribute("data-testid", "units-created");
  createdBox.hidden = true;
  const createdMessage = el("p", "shell-units-created-message");
  createdMessage.setAttribute("data-testid", "units-created-message");
  createdBox.appendChild(createdMessage);
  const createAnother = button("Create another unit");
  createAnother.setAttribute("data-testid", "units-create-another");
  createdBox.appendChild(createAnother);
  createSection.appendChild(createdBox);

  const resetCreateForm = (): void => {
    createTitle.value = "";
    createDescription.value = "";
    showCreateError(null);
  };
  createAnother.addEventListener("click", () => {
    if (controller.beginNewUnit()) {
      resetCreateForm();
      focus(createTitle);
    }
  });

  let shownError: string | null = null;
  const showCreateError = (msg: string | null): void => {
    shownError = msg;
    createError.hidden = msg === null;
    createError.textContent = msg ?? "";
  };

  createForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const s = controller.getState();
    const titleMsg = validateUnitTitle(createTitle.value);
    const descMsg = validateUnitDescription(createDescription.value);
    if (titleMsg !== null || descMsg !== null) {
      showCreateError(titleMsg ?? descMsg);
      focus(titleMsg !== null ? createTitle : createDescription);
      return;
    }
    showCreateError(null);
    void controller.submitCreate({
      grade: s.grade,
      title: createTitle.value.trim(),
      description: createDescription.value.trim(),
    });
  });

  const matchNote = (s: TeacherUnitsViewState, entry: CreateRecoveryEntry): string | null => {
    if (s.recoveryCheck.kind !== "checked") return null;
    const { title, grade } = entry.state.payload;
    const matches = s.recoveryCheck.units.filter(
      (u) => u.grade === grade && u.title.trim() === title.trim(),
    );
    const n = matches.length;
    return n === 0
      ? `No ${gradeLabel(grade)} unit named "${title}" was found. It may still be finishing, so check again before creating it again.`
      : `Found ${n} ${gradeLabel(grade)} unit${n === 1 ? "" : "s"} named "${title}". Review ${n === 1 ? "it" : "them"} in your units.`;
  };

  const needsCheck = (entry: CreateRecoveryEntry): boolean =>
    entry.state.kind === "unresolved" &&
    (entry.state.reason === "replayExpired" ||
      entry.state.reason === "replayRefused" ||
      entry.state.reason === "idempotencyKeyConflict" ||
      entry.state.reason === "schoolContextChanged");

  const renderRecoveryEntry = (s: TeacherUnitsViewState, entry: CreateRecoveryEntry): HTMLElement => {
    const item = el("li", "shell-units-recovery-item");
    item.setAttribute("data-testid", `units-recovery-item-${entry.key}`);
    const { title, grade } = entry.state.payload;
    const msg = el("p", "shell-units-recovery-message");
    item.appendChild(msg);
    const actions = el("div", "shell-units-actions");
    item.appendChild(actions);
    const st = entry.state;
    if (st.kind === "inFlight") {
      msg.textContent = `"${title}" (${gradeLabel(grade)}): checking...`;
    } else if (st.kind === "abandoned") {
      msg.textContent = `"${title}" (${gradeLabel(grade)}) may already have been created. Check your units before creating it again.`;
      const done = button(entry.own ? "Create a new unit" : "I've checked", entry.own ? "primary" : "");
      done.setAttribute("data-testid", `units-recovery-dismiss-${entry.key}`);
      done.addEventListener("click", () => {
        if (entry.own) {
          if (controller.beginNewUnit()) {
            resetCreateForm();
            focus(createTitle);
          }
        } else if (controller.dismissAbandoned(entry.key)) {
          announce(`Request for "${title}" dismissed.`);
        }
      });
      actions.appendChild(done);
    } else {
      msg.textContent = `"${title}" (${gradeLabel(grade)}): ${st.error.message}`;
      if (!needsCheck(entry)) {
        const again = button("Check again", "primary");
        again.setAttribute("data-testid", `units-recovery-reconcile-${entry.key}`);
        again.addEventListener("click", () =>
          void controller.reconcileCreate(
            entry.key,
            st.reason === "unauthorized" ? { reauthorized: true } : {},
          ),
        );
        actions.appendChild(again);
      }
      const aside = button("Set this request aside");
      aside.setAttribute("data-testid", `units-recovery-abandon-${entry.key}`);
      aside.disabled = needsCheck(entry) && s.recoveryCheck.kind !== "checked";
      aside.addEventListener("click", () => {
        if (controller.abandonCreate(entry.key)) announce(`Request for "${title}" set aside.`);
      });
      actions.appendChild(aside);
    }
    const note = matchNote(s, entry);
    if (note !== null) item.appendChild(el("p", "shell-units-recovery-note", note));
    return item;
  };

  const renderRecovery = (s: TeacherUnitsViewState): void => {
    const show = s.recoveries.length > 0 || s.unreadable.length > 0;
    recovery.hidden = !show;
    rebuildKeepingFocus(
      recovery,
      () => {
        if (!show) return;
        recovery.appendChild(
          el(
            "p",
            "shell-units-recovery-intro",
            s.recoveries.length + s.unreadable.length === 1
              ? "One unit request wasn't confirmed."
              : `${s.recoveries.length + s.unreadable.length} unit requests weren't confirmed.`,
          ),
        );
        const list = el("ul", "shell-units-recovery-list");
        for (const entry of s.recoveries) list.appendChild(renderRecoveryEntry(s, entry));
        s.unreadable.forEach((storageKey, i) => {
          const item = el("li", "shell-units-recovery-item");
          item.setAttribute("data-testid", `units-recovery-unreadable-${i}`);
          item.appendChild(
            el(
              "p",
              "shell-units-recovery-message",
              "LyfeLabz found an earlier unit request in this browser but couldn't read it, so it can't be checked automatically. A unit may already have been created. Check your units, then discard the saved request.",
            ),
          );
          const discard = button("Discard saved request");
          discard.setAttribute("data-testid", `units-recovery-discard-${i}`);
          discard.disabled = s.recoveryCheck.kind !== "checked";
          discard.addEventListener("click", () => {
            if (controller.discardUnreadableAttempt(storageKey)) announce("Saved request discarded.");
          });
          const actions = el("div", "shell-units-actions");
          actions.appendChild(discard);
          item.appendChild(actions);
          list.appendChild(item);
        });
        recovery.appendChild(list);
        const footer = el("div", "shell-units-actions");
        const check = button("Check my units");
        check.setAttribute("data-testid", "units-recovery-check");
        check.disabled = s.recoveryCheck.kind === "checking";
        check.addEventListener("click", () => void controller.checkRecovery());
        footer.appendChild(check);
        recovery.appendChild(footer);
        if (s.recoveryCheck.kind === "checking") {
          recovery.appendChild(el("p", "shell-units-recovery-note", "Checking your units..."));
        } else if (s.recoveryCheck.kind === "error") {
          recovery.appendChild(el("p", "shell-units-error", s.recoveryCheck.error.message));
        }
      },
      () => (s.recoveries.length + s.unreadable.length > 0
        ? recovery.querySelector<HTMLElement>("[data-testid=units-recovery-check]")
        : createTitle),
    );
  };

  let prevFormerCount = 0;
  let formerAnnouncement: string | null = null;
  const renderFormerSchool = (s: TeacherUnitsViewState): void => {
    const notices = s.formerSchool;
    const count = notices.kind === "ok" ? notices.attempts.length + notices.unreadable : 0;
    former.hidden = count === 0;
    former.textContent = "";
    if (count > 0 && notices.kind === "ok") {
      const h = el(
        "h4",
        "shell-units-subheading",
        count === 1 ? "Unit request from a previous school" : "Unit requests from a previous school",
      );
      h.id = "units-former-heading";
      former.appendChild(h);
      former.appendChild(
        el(
          "p",
          "shell-units-recovery-message",
          `This browser has ${count === 1 ? "a unit request" : `${count} unit requests`} you started at a previous school that ${count === 1 ? "was" : "were"} never confirmed. LyfeLabz can't check ${count === 1 ? "it" : "them"} while you're signed in for your current school, so ${count === 1 ? "it may or may not have" : "each may or may not have"} been created there. ${count === 1 ? "It" : "They"} won't be created again here. If you need to know what happened, contact your school administrator.`,
        ),
      );
      const items = el("ul", "shell-units-recovery-list");
      notices.attempts.forEach((a, i) => {
        const item = el("li", "shell-units-recovery-item");
        item.setAttribute("data-testid", `units-former-school-item-${i}`);
        let started = "";
        try {
          started = new Date(a.createdAtMs).toLocaleDateString();
        } catch {
          started = "";
        }
        item.appendChild(
          el(
            "p",
            "shell-units-recovery-note",
            `"${a.title}" (${gradeLabel(a.grade)})${started ? `, started ${started}` : ""}${a.status === "abandoned" ? ", set aside" : ""}`,
          ),
        );
        items.appendChild(item);
      });
      if (notices.unreadable > 0) {
        const item = el("li", "shell-units-recovery-item");
        item.setAttribute("data-testid", "units-former-school-unreadable");
        item.appendChild(
          el(
            "p",
            "shell-units-recovery-note",
            notices.unreadable === 1
              ? "One saved request couldn't be read."
              : `${notices.unreadable} saved requests couldn't be read.`,
          ),
        );
        items.appendChild(item);
      }
      former.appendChild(items);
      former.appendChild(
        el("p", "shell-units-recovery-note", "You can still create a new unit here with the form below."),
      );
    }
    // The status region is shared with other actions. Announce only real
    // count changes, and clear only our own message, never another one.
    // "unavailable" is unknown, not zero: drop our message, announce nothing.
    const known = notices.kind === "ok";
    if (!known || count !== prevFormerCount) {
      const ours = formerAnnouncement !== null && status.textContent === formerAnnouncement;
      let next: string | null = null;
      // A new or larger count is new information; a smaller one only
      // replaces our own (now obsolete) message.
      if (known && count > 0 && (count > prevFormerCount || ours)) {
        next =
          count === 1
            ? "One unconfirmed unit request from a previous school is listed in My Units."
            : `${count} unconfirmed unit requests from a previous school are listed in My Units.`;
      } else if (known && prevFormerCount > 0 && ours) {
        next = "No unit requests from a previous school are listed now.";
      }
      if (next !== null) {
        announce(next);
        formerAnnouncement = next;
      } else if (ours) {
        status.textContent = "";
        formerAnnouncement = null;
      }
    }
    prevFormerCount = known ? count : 0;
  };

  let prevCreateKind: TeacherUnitsViewState["create"]["kind"] = "idle";
  let prevConfirmed: TeacherUnitsViewState["lastConfirmed"] = null;

  const renderCreate = (s: TeacherUnitsViewState): void => {
    const create = s.create;
    renderRecovery(s);
    renderFormerSchool(s);
    const locked =
      s.recoveries.length > 0 ||
      s.unreadable.length > 0 ||
      create.kind === "inFlight" ||
      create.kind === "unresolved" ||
      create.kind === "abandoned" ||
      create.kind === "created";
    createForm.hidden = create.kind === "created";
    createTitle.disabled = locked;
    createDescription.disabled = locked;
    createSubmit.disabled = locked;
    createSubmit.setAttribute("aria-busy", create.kind === "inFlight" ? "true" : "false");
    createSubmit.textContent = create.kind === "inFlight" ? "Creating..." : `Create ${gradeLabel(s.grade)} unit`;

    const blockedMsg = s.createBlocked !== null ? BLOCKED_MESSAGES[s.createBlocked] ?? null : null;
    if (create.kind === "rejected") showCreateError(create.error.message);
    else if (blockedMsg !== null) showCreateError(blockedMsg);
    else if (s.storage.kind === "unavailable") {
      showCreateError(
        "This browser isn't letting LyfeLabz save data, so new units can't be created safely here. Check that this browser allows site data.",
      );
    } else if (shownError !== null && create.kind !== "idle") showCreateError(null);

    createdBox.hidden = create.kind !== "created";
    if (create.kind === "created") {
      createdMessage.textContent = `Created "${create.unit.title}" (${gradeLabel(create.unit.grade)}).`;
    }

    // Transitions: announce and move focus to the next meaningful control,
    // since the control that started the action may now be hidden.
    if (prevCreateKind !== create.kind) {
      if (create.kind === "created") {
        announce(`Created "${create.unit.title}" in ${gradeLabel(create.unit.grade)}.`);
        focus(createAnother);
      } else if (prevCreateKind === "inFlight" && create.kind === "unresolved") {
        announce(create.error.message);
        focus(
          recovery.querySelector<HTMLElement>(`[data-testid=units-recovery-reconcile-${create.key}]`) ??
            recovery.querySelector<HTMLElement>("[data-testid=units-recovery-check]"),
        );
      } else if (prevCreateKind === "inFlight" && create.kind === "rejected") {
        focus(createTitle);
      }
    }
    prevCreateKind = create.kind;
    if (s.lastConfirmed !== null && s.lastConfirmed !== prevConfirmed && create.kind !== "created") {
      announce(`Confirmed: "${s.lastConfirmed.unit.title}" was created.`);
    }
    prevConfirmed = s.lastConfirmed;
  };

  // ---------- List ----------
  const listState = el("div", "shell-units-list-state");
  listState.setAttribute("data-testid", "units-list-state");
  root.appendChild(listState);
  const list = el("ul", "shell-units-list");
  list.setAttribute("data-testid", "units-list");
  list.setAttribute("aria-label", "Units");
  root.appendChild(list);
  const cards = new Map<string, CardView>();

  const closeEditor = (card: CardView, focusEdit: boolean): void => {
    card.editor?.form.remove();
    card.editor = null;
    if (!cards.has(card.unit.unitId) || !isListed(card.unit.unitId)) {
      // A pinned card (kept only for its editor) leaves with the editor.
      card.li.remove();
      cards.delete(card.unit.unitId);
      if (focusEdit) focus(heading);
      return;
    }
    renderCardBody(card);
    if (focusEdit) focus(card.li.querySelector<HTMLButtonElement>("[data-action=edit]"));
  };

  const isListed = (unitId: string): boolean => {
    const s = controller.getState();
    return s.list.kind === "ready" && s.list.units.some((u) => u.unitId === unitId);
  };

  // A unit's outcome notice: in its card while the card is attached, else
  // in the panel's outcome region, so it always stays visible and announced.
  const showNotice = (card: CardView, msg: string | null, kind: "conflict" | "error" = "error"): void => {
    const unitId = card.unit.unitId;
    clearOutcome(unitId);
    const attached = msg !== null && card.li.isConnected;
    card.notice.hidden = !attached;
    card.notice.textContent = attached ? msg : "";
    card.notice.className = `shell-units-notice shell-units-notice--${kind}`;
    if (msg !== null && !attached) {
      setOutcome(unitId, controller.getKnownUnit(unitId)?.title ?? card.unit.title, msg, kind);
    }
  };
  // A card leaving the list hands a visible notice to the outcome region.
  const keepNotice = (card: CardView): void => {
    if (card.notice.hidden || card.notice.textContent === "") return;
    const kind = card.notice.className.includes("--conflict") ? "conflict" : "error";
    setOutcome(card.unit.unitId, card.unit.title, card.notice.textContent ?? "", kind);
  };

  const handleResult = (card: CardView, result: UnitMutationResult, verb: string): void => {
    if (disposed) return;
    switch (result.kind) {
      case "saved":
        showNotice(card, null);
        announce(result.noop ? "No changes to save." : `${verb}: "${result.unit.title}".`);
        return;
      case "invalid":
        if (card.editor) {
          card.editor.error.hidden = false;
          card.editor.error.textContent = result.message;
          focus(result.field === "title" ? card.editor.title : card.editor.description);
        }
        return;
      case "conflict":
        showNotice(
          card,
          result.latest === null
            ? "This unit changed somewhere else and the latest version couldn't be loaded. Refresh, then try again."
            : `This unit changed somewhere else, so your change wasn't saved. Its current name is "${result.latest.title}"${
                result.latest.description.length > 0
                  ? ` and its current description is "${result.latest.description}"`
                  : " with no description"
              }. Your edits are still here. Review them, then save again.`,
          "conflict",
        );
        return;
      case "archived":
        showNotice(
          card,
          card.editor !== null
            ? "This unit was archived somewhere else, so your changes weren't saved. They are still here. Restore the unit to save them, or cancel to discard them."
            : "This unit was archived somewhere else.",
          "conflict",
        );
        return;
      case "error":
      case "uncertain":
        showNotice(card, result.error.message);
        return;
      case "busy":
      case "stale":
        return;
    }
  };

  const openEditor = (card: CardView): void => {
    if (card.editor !== null) return;
    const form = el("form", "shell-units-form shell-units-edit");
    form.noValidate = true;
    const title = el("input", "shell-units-input");
    title.type = "text";
    title.maxLength = TEACHER_UNIT_TITLE_MAX_LENGTH;
    title.value = card.unit.title;
    form.appendChild(field("Unit name", title, `units-edit-title-${card.unit.unitId}`));
    const description = el("textarea", "shell-units-input shell-units-textarea");
    description.rows = 3;
    description.maxLength = TEACHER_UNIT_DESCRIPTION_MAX_LENGTH;
    description.value = card.unit.description;
    form.appendChild(field("Description", description, `units-edit-description-${card.unit.unitId}`));
    const error = el("p", "shell-units-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    form.appendChild(error);
    const actions = el("div", "shell-units-actions");
    const save = button("Save", "primary");
    save.type = "submit";
    save.setAttribute("data-testid", `units-edit-save-${card.unit.unitId}`);
    const cancel = button("Cancel");
    cancel.setAttribute("data-testid", `units-edit-cancel-${card.unit.unitId}`);
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);
    const editor: EditorView = { form, title, description, error, save };
    card.editor = editor;
    cancel.addEventListener("click", () => {
      showNotice(card, null);
      closeEditor(card, true);
    });
    form.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        showNotice(card, null);
        closeEditor(card, true);
      }
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (save.disabled) return;
      error.hidden = true;
      void controller
        .updateUnit(card.unit.unitId, { title: title.value, description: description.value })
        .then((result) => {
          handleResult(card, result, "Saved");
          if (result.kind === "saved" && card.editor === editor) closeEditor(card, true);
        });
    });
    renderCardBody(card);
    card.li.insertBefore(form, card.notice);
    focus(title);
  };

  // ---------- Resources (U2.3) ----------
  //
  // Membership changes go through the controller (teacherUnitsSetResources
  // with the held revision). Nothing is shown as added or removed until the
  // server confirms it; the list always renders the last server state.

  // Each request announces its own pending message in the shared status
  // region and, when it settles, clears only that message, and only if it
  // is still showing. Another action's message is never cleared, and a
  // settled request never leaves "Adding..." behind.
  let pendingSeq = 0;
  const announcePending = (msg: string): (() => void) => {
    announce(msg);
    const token = ++pendingSeq;
    statusOwner = token;
    return () => {
      if (statusOwner === token) {
        statusOwner = 0;
        status.textContent = "";
      }
    };
  };

  const addButtonOf = (card: CardView): HTMLElement | null =>
    card.li.querySelector<HTMLElement>(`[data-testid="units-resources-add-${card.unit.unitId}"]`);

  // ---------- Membership confirmation evidence ----------
  //
  // A settled membership request is described from two facts only:
  // 1. what the response proves: `noop` means the server wrote nothing
  //    (never "saved"); otherwise the server committed the write;
  // 2. what the latest accepted state of the WHOLE unit holds now
  //    (`getUnitState`: active or archived with its full record, or not
  //    current: omitted, not found, or never seen). Whether a card is shown
  //    is never evidence: an archived unit may be hidden and still hold
  //    the resource.
  // Presence or absence is claimed only when that state supports it. A
  // claim that a change "somewhere else" happened needs a newer revision
  // than the response; anything else is stated neutrally.
  const NOTHING_CHANGED_REFRESH = "Nothing was changed. Refresh to see this unit's current resources.";
  // Where the teacher can check a unit's resources now. "Shown" is claimed
  // only while its card is in the list.
  const whereNow = (unitId: string): string | null => {
    if (isListed(unitId)) return null;
    return controller.getUnitState(unitId).kind === "archived"
      ? "This unit is archived, so it isn't shown. Turn on Show archived units to see its resources."
      : "This unit isn't in your current list. Refresh to see its resources.";
  };
  const uncertainText = (unitId: string): string => {
    const where = whereNow(unitId);
    return where === null
      ? "LyfeLabz couldn't confirm whether your change was saved. The resources shown are what this unit holds now. Check them before trying again."
      : `LyfeLabz couldn't confirm whether your change was saved. ${where} Check before trying again.`;
  };
  // The full current record, or null when the unit is not current.
  const currentUnit = (unitId: string): TeacherUnit | null => {
    const st = controller.getUnitState(unitId);
    return st.kind === "active" || st.kind === "archived" ? st.unit : null;
  };
  // Appended to a statement about the current state.
  const archivedNote = (u: TeacherUnit): string => (u.status === "archived" ? ` "${u.title}" is archived.` : "");
  // Appended after a change made elsewhere: where the teacher can see it.
  const whereShown = (u: TeacherUnit): string =>
    u.status === "archived" ? archivedNote(u) : isListed(u.unitId) ? " Its current resources are shown." : "";
  const savedRefresh = (title: string): string =>
    `Your change to "${title}" was saved. Refresh to see this unit's current resources.`;
  type Outcome = { readonly announce: string } | { readonly uncertain: true };
  type Saved = Extract<UnitMutationResult, { kind: "saved" }>;
  // "Changed somewhere else" needs a record newer than what this request
  // established: the committed revision for a write (the response record is
  // a later read and may already include other sessions' changes), the
  // response snapshot for a no-op.
  const baseRevision = (result: Saved): number => result.committed?.revision ?? result.unit.revision;

  const removeOutcome = (result: Saved, resourceId: string, name: string): Outcome => {
    const cur = currentUnit(result.unit.unitId);
    const write = !result.noop;
    if (cur === null) return { announce: write ? savedRefresh(result.unit.title) : NOTHING_CHANGED_REFRESH };
    if (!cur.resourceIds.includes(resourceId)) {
      return {
        announce:
          (write ? `Removed "${name}" from "${cur.title}".` : `"${name}" isn't in "${cur.title}", so nothing was changed.`) +
          archivedNote(cur),
      };
    }
    if (cur.revision <= baseRevision(result)) {
      return write ? { uncertain: true } : { announce: NOTHING_CHANGED_REFRESH };
    }
    return {
      announce:
        (write
          ? `Your removal was saved, but "${name}" is in "${cur.title}" again because this unit changed somewhere else.`
          : `Nothing was changed. "${name}" is in "${cur.title}" because this unit changed somewhere else.`) + whereShown(cur),
    };
  };

  const addOutcome = (result: Saved, ids: ReadonlyArray<string>): Outcome => {
    const cur = currentUnit(result.unit.unitId);
    const write = !result.noop;
    if (cur === null) return { announce: write ? savedRefresh(result.unit.title) : NOTHING_CHANGED_REFRESH };
    // A write added exactly what it sent beyond the list it was based on; a
    // no-op proves every chosen id was already there when the server read
    // the unit. Neither is inferred from the post-commit record.
    const targets = write
      ? result.committed !== undefined
        ? result.committed.resourceIds.filter((id) => !(result.committed as MembershipCommit).previous.includes(id))
        : ids
      : ids;
    const missing = targets.some((id) => !cur.resourceIds.includes(id));
    if (!missing) {
      const n = targets.length;
      return {
        announce:
          (write
            ? `Added ${n === 1 ? "1 resource" : `${n} resources`} to "${cur.title}".`
            : `Those resources are already in "${cur.title}", so nothing was changed.`) + archivedNote(cur),
      };
    }
    if (cur.revision <= baseRevision(result)) {
      return write ? { uncertain: true } : { announce: NOTHING_CHANGED_REFRESH };
    }
    return {
      announce:
        (write
          ? `Your addition was saved, but "${cur.title}" changed somewhere else since, so not every resource you added is in it now.`
          : `Nothing was changed. "${cur.title}" changed somewhere else since, so not every resource you chose is in it now.`) +
        whereShown(cur),
    };
  };

  const repairOutcome = (result: Saved, before: ReadonlySet<string>): Outcome => {
    const cur = currentUnit(result.unit.unitId);
    const write = !result.noop;
    if (cur === null) return { announce: write ? savedRefresh(result.unit.title) : NOTHING_CHANGED_REFRESH };
    if (retiredCount(cur) === 0) {
      // What this write removed: its base list minus the list it sent.
      const removed =
        result.committed !== undefined
          ? result.committed.previous.filter(
              (id) => isUnavailable(id) && !(result.committed as MembershipCommit).resourceIds.includes(id),
            ).length
          : before.size;
      return {
        announce:
          (write
            ? `Removed ${plural(removed, "unavailable resource", "unavailable resources")} from "${cur.title}".`
            : `"${cur.title}" has no unavailable resources, so nothing was changed.`) + archivedNote(cur),
      };
    }
    if (cur.revision <= baseRevision(result)) {
      return write ? { uncertain: true } : { announce: NOTHING_CHANGED_REFRESH };
    }
    return {
      announce:
        (write
          ? `Your change was saved, but "${cur.title}" has unavailable resources again because it changed somewhere else.`
          : `Nothing was changed. "${cur.title}" has unavailable resources because it changed somewhere else.`) +
        whereShown(cur),
    };
  };

  // Shows a settled membership outcome; true when it was announced.
  const showOutcome = (card: CardView, outcome: Outcome): boolean => {
    if ("uncertain" in outcome) {
      showNotice(card, uncertainText(card.unit.unitId), "conflict");
      return false;
    }
    showNotice(card, null);
    announce(outcome.announce);
    return true;
  };

  // Notices for a membership request that did not confirm a change.
  const membershipNotice = (card: CardView, result: UnitMutationResult, action: "add" | "remove"): void => {
    const nothing = action === "add" ? "nothing was added" : "nothing was removed";
    const where = whereNow(card.unit.unitId);
    switch (result.kind) {
      case "conflict":
        showNotice(
          card,
          result.latest === null
            ? `This unit changed somewhere else, so ${nothing}, and its latest version couldn't be loaded. Refresh, then try again.`
            : where === null
              ? `This unit changed somewhere else, so ${nothing}. Its current resources are shown. Review them, then try again.`
              : `This unit changed somewhere else, so ${nothing}. ${where}`,
          "conflict",
        );
        return;
      case "archived":
        showNotice(
          card,
          `This unit is archived, so ${nothing}. Restore it to change its resources.`,
          "conflict",
        );
        return;
      case "uncertain":
        showNotice(
          card,
          result.latest === null
            ? "LyfeLabz couldn't confirm whether your change was saved, and the unit couldn't be loaded. Refresh before trying again."
            : uncertainText(card.unit.unitId),
          "conflict",
        );
        return;
      case "error":
        showNotice(card, result.error.message);
        return;
      default:
        return;
    }
  };

  // Why the card's picker may not add right now, or null.
  const pickerBlocked = (card: CardView): "archived" | "retired" | null => {
    if (card.unit.status !== "active") return "archived";
    return retiredCount(card.unit) > 0 ? "retired" : null;
  };

  const closePicker = (card: CardView, focusAdd: boolean): void => {
    card.picker?.form.remove();
    card.picker = null;
    if (card.li.isConnected) renderCardBody(card);
    if (focusAdd) focus(addButtonOf(card) ?? card.li.querySelector<HTMLElement>("button") ?? heading);
  };

  const renderPickerOptions = (card: CardView): void => {
    const picker = card.picker;
    if (picker === null) return;
    const u = card.unit;
    const busy = controller.getState().busyUnitIds.has(u.unitId);
    const present = new Set(u.resourceIds);
    // A resource that joined the unit (here or elsewhere) is no longer a choice.
    for (const id of Array.from(picker.selected)) if (present.has(id)) picker.selected.delete(id);
    const matches = filterPlaceableResources({ unitGrade: u.grade, search: picker.search.value });
    const gradeHasResources = filterPlaceableResources({ unitGrade: u.grade }).length > 0;
    rebuildKeepingFocus(
      picker.options,
      () => {
        if (!gradeHasResources) {
          picker.options.appendChild(
            el("li", "shell-units-empty", `There are no LyfeLabz resources for ${gradeLabel(u.grade)} units yet.`),
          );
          return;
        }
        if (matches.length === 0) {
          picker.options.appendChild(el("li", "shell-units-empty", "No resources match your search."));
          return;
        }
        for (const r of matches) {
          const li = el("li", "shell-units-picker-option");
          const label = el("label", "shell-units-picker-label");
          const box = el("input");
          box.type = "checkbox";
          box.value = r.id;
          box.setAttribute("data-testid", `units-picker-option-${u.unitId}-${r.id}`);
          const inUnit = present.has(r.id);
          box.checked = inUnit || picker.selected.has(r.id);
          box.disabled = inUnit || busy;
          box.addEventListener("change", () => {
            if (box.checked) picker.selected.add(r.id);
            else picker.selected.delete(r.id);
            updatePickerSubmit(card);
          });
          label.appendChild(box);
          const text = el("span", "shell-units-resource-text");
          text.appendChild(el("span", "shell-lesson-resource-type", resourceTypeLabel(r)));
          text.appendChild(el("span", "shell-lesson-resource-title", r.title));
          if (inUnit) text.appendChild(el("span", "shell-units-resource-meta", "Already in this unit"));
          else if (resourceEligibility(r) === "organizeOnly") {
            text.appendChild(el("span", "shell-units-resource-meta", "Can be organized here, not assigned"));
          }
          label.appendChild(text);
          li.appendChild(label);
          picker.options.appendChild(li);
        }
      },
      () => picker.search,
    );
    updatePickerSubmit(card);
  };

  const updatePickerSubmit = (card: CardView): void => {
    const picker = card.picker;
    if (picker === null) return;
    const busy = controller.getState().busyUnitIds.has(card.unit.unitId);
    const n = picker.selected.size;
    picker.submit.disabled = n === 0 || busy || pickerBlocked(card) !== null;
    picker.submit.setAttribute("aria-busy", busy ? "true" : "false");
    picker.submit.textContent = busy ? "Adding..." : n === 0 ? "Add selected" : `Add selected (${n})`;
  };

  const openPicker = (card: CardView): void => {
    if (card.picker !== null) {
      focus(card.picker.search);
      return;
    }
    const u = card.unit;
    const form = el("form", "shell-units-form shell-units-picker");
    form.noValidate = true;
    form.setAttribute("data-testid", `units-picker-${u.unitId}`);
    const headingId = uid("picker-heading");
    form.setAttribute("aria-labelledby", headingId);
    const h = el("h5", "shell-units-subheading", `Add resources to "${u.title}"`);
    h.id = headingId;
    form.appendChild(h);
    form.appendChild(
      el("p", "shell-units-recovery-note", `Showing LyfeLabz resources for ${gradeLabel(u.grade)}.`),
    );
    const search = el("input", "shell-units-input");
    search.type = "search";
    search.autocomplete = "off";
    form.appendChild(field("Search resources", search, `units-picker-search-${u.unitId}`));
    const fieldset = el("fieldset", "shell-units-picker-fieldset");
    fieldset.appendChild(el("legend", "shell-units-field-label", "Choose resources"));
    const options = el("ul", "shell-units-picker-options");
    options.setAttribute("data-testid", `units-picker-options-${u.unitId}`);
    fieldset.appendChild(options);
    form.appendChild(fieldset);
    const actions = el("div", "shell-units-actions");
    const submit = button("Add selected", "primary");
    submit.type = "submit";
    submit.setAttribute("data-testid", `units-picker-submit-${u.unitId}`);
    const cancel = button("Cancel");
    cancel.setAttribute("data-testid", `units-picker-cancel-${u.unitId}`);
    actions.appendChild(submit);
    actions.appendChild(cancel);
    form.appendChild(actions);
    const picker: PickerView = { form, search, options, submit, selected: new Set<string>() };
    card.picker = picker;

    search.addEventListener("input", () => renderPickerOptions(card));
    cancel.addEventListener("click", () => closePicker(card, true));
    form.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closePicker(card, true);
      }
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      // Eligibility is re-checked against the current unit, not the state
      // the picker was opened with.
      if (card.picker !== picker || pickerBlocked(card) !== null) return;
      if (submit.disabled || picker.selected.size === 0) return;
      // Canonical registry order, not click order.
      const ids = getPlaceableResources()
        .map((r) => r.id)
        .filter((id) => picker.selected.has(id));
      const unitTitle = card.unit.title;
      const clearPending = announcePending(
        `Adding ${ids.length === 1 ? "1 resource" : `${ids.length} resources`} to "${unitTitle}"...`,
      );
      void controller.addResources(card.unit.unitId, ids).then((result) => {
        if (disposed) return;
        clearPending();
        if (result.kind === "stale" || result.kind === "busy") return;
        if (result.kind === "saved") {
          showOutcome(card, addOutcome(result, ids));
          if (card.picker === picker) closePicker(card, true);
          return;
        }
        membershipNotice(card, result, "add");
        if (result.kind === "archived" && card.picker === picker) closePicker(card, true);
        else if (card.picker === picker) {
          renderPickerOptions(card);
          focus(picker.submit.disabled ? picker.search : picker.submit);
        } else focus(addButtonOf(card) ?? card.li.querySelector<HTMLElement>("button"));
      });
    });
    card.li.insertBefore(form, card.notice);
    renderCardBody(card);
    renderPickerOptions(card);
    focus(search);
  };

  const removeResource = (card: CardView, resourceId: string, name: string, index: number): void => {
    const unitTitle = card.unit.title;
    const clearPending = announcePending(`Removing "${name}" from "${unitTitle}"...`);
    void controller.removeResource(card.unit.unitId, resourceId).then((result) => {
      if (disposed) return;
      clearPending();
      if (result.kind === "stale" || result.kind === "busy") return;
      if (result.kind === "saved") {
        showOutcome(card, removeOutcome(result, resourceId, name));
        // Focus the resource's row if it is still shown, else the row that
        // took its place, else Add resources.
        const still = card.li.querySelector<HTMLElement>(
          `[data-testid="units-resource-remove-${card.unit.unitId}-${resourceId}"]`,
        );
        const removes = card.li.querySelectorAll<HTMLElement>("[data-action=remove-resource]");
        focus(still ?? removes[Math.min(index, removes.length - 1)] ?? addButtonOf(card) ?? heading);
        return;
      }
      membershipNotice(card, result, "remove");
      focus(
        card.li.querySelector<HTMLElement>(`[data-testid="units-resource-remove-${card.unit.unitId}-${resourceId}"]`) ??
          addButtonOf(card) ??
          card.li.querySelector<HTMLElement>("button"),
      );
    });
  };

  const isUnavailable = (id: string): boolean => resolveUnitResources([id])[0].status === "unavailable";
  const retiredCount = (u: TeacherUnit): number =>
    resolveUnitResources(u.resourceIds).filter((r) => r.status === "unavailable").length;
  const plural = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const retiredButtonOf = (card: CardView): HTMLElement | null =>
    card.li.querySelector<HTMLElement>(`[data-testid="units-retired-remove-${card.unit.unitId}"]`);

  // Explicitly confirmed removal of every retired membership in one request
  // (the server refuses any list that still names one).
  const removeRetired = (card: CardView, shown: number): void => {
    const u = card.unit;
    const before = new Set(u.resourceIds.filter(isUnavailable));
    card.confirmRetired = null;
    const clearPending = announcePending(
      `Removing ${plural(shown, "unavailable resource", "unavailable resources")} from "${u.title}"...`,
    );
    renderCardBody(card);
    void controller.removeRetiredResources(u.unitId).then((result) => {
      if (disposed) return;
      clearPending();
      if (result.kind === "stale" || result.kind === "busy") return;
      if (result.kind === "saved") {
        showOutcome(card, repairOutcome(result, before));
        focus(retiredButtonOf(card) ?? addButtonOf(card) ?? card.li.querySelector<HTMLElement>("button"));
        return;
      }
      membershipNotice(card, result, "remove");
      focus(retiredButtonOf(card) ?? addButtonOf(card) ?? card.li.querySelector<HTMLElement>("button"));
    });
  };

  const renderRetiredRepair = (card: CardView, busy: boolean, count: number): HTMLElement => {
    const u = card.unit;
    const box = el("div", "shell-units-notice shell-units-notice--conflict shell-units-retired");
    box.setAttribute("data-testid", `units-retired-${u.unitId}`);
    if (card.confirmRetired !== count) card.confirmRetired = null;
    const actions = el("div", "shell-units-actions");
    if (card.confirmRetired === null) {
      box.appendChild(
        el(
          "p",
          "shell-units-recovery-message",
          `${count === 1 ? "1 resource in this unit is" : `${count} resources in this unit are`} no longer available. Remove ${count === 1 ? "it" : "them"} before adding or removing other resources.`,
        ),
      );
      const start = button(`Remove ${plural(count, "unavailable resource", "unavailable resources")}`);
      start.setAttribute("data-testid", `units-retired-remove-${u.unitId}`);
      start.disabled = busy;
      start.addEventListener("click", () => {
        card.confirmRetired = count;
        renderCardBody(card);
        focus(card.li.querySelector<HTMLElement>(`[data-testid="units-retired-confirm-${u.unitId}"]`));
      });
      actions.appendChild(start);
    } else {
      box.appendChild(
        el(
          "p",
          "shell-units-recovery-message",
          `Remove ${plural(count, "unavailable resource", "unavailable resources")} from "${u.title}"? The other resources in this unit stay, in the same order.`,
        ),
      );
      const confirm = button(`Remove ${count === 1 ? "it" : `all ${count}`}`, "danger");
      confirm.setAttribute("data-testid", `units-retired-confirm-${u.unitId}`);
      confirm.disabled = busy;
      confirm.addEventListener("click", () => removeRetired(card, count));
      const cancel = button("Cancel");
      cancel.setAttribute("data-testid", `units-retired-cancel-${u.unitId}`);
      cancel.addEventListener("click", () => {
        card.confirmRetired = null;
        renderCardBody(card);
        focus(retiredButtonOf(card));
      });
      actions.appendChild(confirm);
      actions.appendChild(cancel);
    }
    box.appendChild(actions);
    return box;
  };

  const renderResources = (card: CardView, busy: boolean): HTMLElement => {
    const u = card.unit;
    const section = el("div", "shell-units-resources");
    section.setAttribute("data-testid", `units-resources-${u.unitId}`);
    const headingId = uid("resources-heading");
    section.setAttribute("role", "group");
    section.setAttribute("aria-labelledby", headingId);
    const resolved = resolveUnitResources(u.resourceIds);
    const retired = retiredCount(u);
    const h = el(
      "h5",
      "shell-units-resources-heading",
      resolved.length === 0 ? "Resources" : `Resources (${resolved.length})`,
    );
    h.id = headingId;
    section.appendChild(h);
    if (resolved.length === 0) {
      section.appendChild(el("p", "shell-units-empty", "No resources in this unit yet."));
    } else {
      // Server order (unit.resourceIds); never re-sorted here.
      const ol = el("ol", "shell-units-resource-list");
      ol.setAttribute("data-testid", `units-resource-list-${u.unitId}`);
      resolved.forEach((entry, i) => {
        const li = el("li", "shell-units-resource");
        li.setAttribute("data-resource-id", entry.id);
        const text = el("span", "shell-units-resource-text");
        const name = entry.status === "available" ? entry.resource.title : "A resource that is no longer available";
        if (entry.status === "available") {
          text.appendChild(el("span", "shell-lesson-resource-type", resourceTypeLabel(entry.resource)));
          text.appendChild(el("span", "shell-lesson-resource-title", name));
          const meta: string[] = [];
          if (entry.resource.grade !== null) meta.push(`Grade ${entry.resource.grade}`);
          if (resourceEligibility(entry.resource) === "organizeOnly") meta.push("Not assignable");
          if (meta.length > 0) text.appendChild(el("span", "shell-units-resource-meta", meta.join(" \u00b7 ")));
        } else {
          text.appendChild(el("span", "shell-lesson-resource-title", name));
        }
        li.appendChild(text);
        // Retired rows are removed together (below); one at a time would be
        // refused while another retired id remains.
        if (u.status === "active" && entry.status === "available") {
          const remove = button("Remove");
          remove.setAttribute("data-action", "remove-resource");
          remove.setAttribute("data-testid", `units-resource-remove-${u.unitId}-${entry.id}`);
          remove.setAttribute("aria-label", `Remove ${name} from ${u.title}`);
          remove.disabled = busy || retired > 0;
          remove.addEventListener("click", () => removeResource(card, entry.id, name, i));
          li.appendChild(remove);
        }
        ol.appendChild(li);
      });
      section.appendChild(ol);
    }
    if (u.status !== "active") {
      card.confirmRetired = null;
      section.appendChild(
        el("p", "shell-units-recovery-note", "Restore this unit to add or remove resources."),
      );
    } else if (retired > 0) {
      section.appendChild(renderRetiredRepair(card, busy, retired));
    }
    return section;
  };

  const renderCardBody = (card: CardView): void => {
    const u = card.unit;
    const busy = controller.getState().busyUnitIds.has(u.unitId);
    // An open picker follows the current unit: it closes when the unit is
    // archived or now holds unavailable resources (the repair comes first).
    let refocus = false;
    const blocked = card.picker !== null ? pickerBlocked(card) : null;
    if (card.picker !== null && blocked !== null) {
      refocus = card.picker.form.contains(doc.activeElement);
      card.picker.form.remove();
      card.picker = null;
      if (blocked === "retired") {
        showNotice(
          card,
          "Some resources in this unit are no longer available, so adding resources was closed. Remove the unavailable resources first, then add resources again.",
          "conflict",
        );
      }
    }
    card.li.classList.toggle("shell-units-card--archived", u.status === "archived");
    card.li.setAttribute("aria-busy", busy ? "true" : "false");
    rebuildKeepingFocus(
      card.body,
      () => {
        if (card.editor !== null) {
          card.body.appendChild(
            el("p", "shell-units-editing", `Editing "${u.title}" (${gradeLabel(u.grade)})`),
          );
          const blocked = card.gone || u.status !== "active";
          card.editor.save.disabled = busy || blocked;
          if (card.gone) {
            card.body.appendChild(
              el(
                "p",
                "shell-units-notice shell-units-notice--error",
                "This unit is no longer available, so your changes can't be saved. Copy anything you need, then cancel.",
              ),
            );
          } else if (u.status === "archived") {
            card.body.appendChild(
              el(
                "p",
                "shell-units-notice shell-units-notice--conflict",
                "This unit is archived, so your changes can't be saved yet. Restore it to keep editing, or cancel to discard your changes.",
              ),
            );
            const actions = el("div", "shell-units-actions");
            const restore = button("Restore");
            restore.setAttribute("data-testid", `units-editor-restore-${u.unitId}`);
            restore.disabled = busy;
            restore.addEventListener("click", () => {
              void controller.restoreUnit(u.unitId).then((r) => {
                handleResult(card, r, "Restored");
                if (r.kind === "saved") {
                  showNotice(card, null);
                  focus(card.editor?.title ?? null);
                }
              });
            });
            actions.appendChild(restore);
            card.body.appendChild(actions);
          }
          return;
        }
        const titleRow = el("div", "shell-units-card-title-row");
        titleRow.appendChild(el("h4", "shell-units-card-title", u.title));
        if (u.status === "archived") titleRow.appendChild(el("span", "shell-units-badge", "Archived"));
        card.body.appendChild(titleRow);
        if (u.description.length > 0) {
          card.body.appendChild(el("p", "shell-units-card-description", u.description));
        }
        card.body.appendChild(renderResources(card, busy));
        const actions = el("div", "shell-units-actions");
        if (u.status === "active") {
          const add = button("Add resources");
          add.setAttribute("data-action", "add-resources");
          add.setAttribute("data-testid", `units-resources-add-${u.unitId}`);
          add.setAttribute("aria-label", `Add resources to ${u.title}`);
          add.setAttribute("aria-expanded", card.picker !== null ? "true" : "false");
          add.disabled = busy || retiredCount(u) > 0;
          add.addEventListener("click", () => openPicker(card));
          actions.appendChild(add);
          const edit = button("Edit");
          edit.setAttribute("data-action", "edit");
          edit.setAttribute("data-testid", `units-edit-${u.unitId}`);
          edit.setAttribute("aria-label", `Edit ${u.title}`);
          edit.disabled = busy;
          edit.addEventListener("click", () => openEditor(card));
          actions.appendChild(edit);
          const archive = button("Archive", "danger");
          archive.setAttribute("data-testid", `units-archive-${u.unitId}`);
          archive.setAttribute("aria-label", `Archive ${u.title}`);
          archive.disabled = busy;
          archive.addEventListener("click", () => {
            void controller.archiveUnit(u.unitId).then((r) => {
              handleResult(card, r, "Archived");
              if (r.kind === "saved" && !controller.getState().showArchived) focus(heading);
            });
          });
          actions.appendChild(archive);
        } else {
          const restore = button("Restore");
          restore.setAttribute("data-testid", `units-restore-${u.unitId}`);
          restore.setAttribute("aria-label", `Restore ${u.title}`);
          restore.disabled = busy;
          restore.addEventListener("click", () => {
            void controller.restoreUnit(u.unitId).then((r) => handleResult(card, r, "Restored"));
          });
          actions.appendChild(restore);
        }
        card.body.appendChild(actions);
      },
      () => (card.li.isConnected ? card.li.querySelector<HTMLElement>("button") : heading),
    );
    if (card.picker !== null) renderPickerOptions(card);
    if (refocus) {
      focus(
        retiredButtonOf(card) ?? addButtonOf(card) ?? card.li.querySelector<HTMLElement>("button") ?? heading,
      );
    }
  };

  const makeCard = (unit: TeacherUnit): CardView => {
    const li = el("li", "shell-units-card");
    li.setAttribute("data-testid", `units-card-${unit.unitId}`);
    li.setAttribute("data-unit-id", unit.unitId);
    const body = el("div", "shell-units-card-body");
    li.appendChild(body);
    const notice = el("p", "shell-units-notice");
    notice.setAttribute("role", "alert");
    notice.hidden = true;
    li.appendChild(notice);
    return { li, unit, gone: false, editor: null, picker: null, confirmRetired: null, notice, body };
  };

  const renderList = (s: TeacherUnitsViewState): void => {
    listState.textContent = "";
    if (s.list.kind === "loading") {
      listState.appendChild(el("p", "shell-status", "Loading units..."));
      return;
    }
    if (s.list.kind === "error") {
      const box = el("div", "shell-units-error");
      box.setAttribute("role", "alert");
      box.appendChild(el("p", "", s.list.error.message || "Your units couldn't be loaded."));
      const retry = button("Try again");
      retry.setAttribute("data-testid", "units-retry");
      retry.addEventListener("click", () => void controller.refresh());
      box.appendChild(retry);
      listState.appendChild(box);
      return;
    }
    const units = s.list.units;
    const ids = new Set(units.map((u) => u.unitId));
    // Cards whose unit left the list are removed, unless an editor is open:
    // those stay pinned (with the latest known server state) so unsaved
    // edits are never discarded by a refresh, an archive, or a grade change.
    const pinned: CardView[] = [];
    for (const [id, c] of cards) {
      if (ids.has(id)) continue;
      if (c.editor !== null) {
        const latest = controller.getKnownUnit(id);
        c.gone = latest === null;
        if (latest !== null) c.unit = latest;
        renderCardBody(c);
        pinned.push(c);
      } else {
        keepNotice(c);
        c.li.remove();
        cards.delete(id);
      }
    }
    if (units.length === 0 && pinned.length === 0) {
      listState.appendChild(
        el(
          "p",
          "shell-units-empty",
          s.showArchived
            ? `You don't have any ${gradeLabel(s.grade)} units yet.`
            : `You don't have any active ${gradeLabel(s.grade)} units. Create one above.`,
        ),
      );
    }
    const ordered: CardView[] = [];
    for (const u of units) {
      let card = cards.get(u.unitId);
      if (card === undefined) {
        card = makeCard(u);
        cards.set(u.unitId, card);
      }
      card.unit = u;
      card.gone = false;
      renderCardBody(card);
      ordered.push(card);
    }
    ordered.push(...pinned);
    ordered.forEach((card, i) => {
      if (list.children[i] !== card.li) list.insertBefore(card.li, list.children[i] ?? null);
    });
  };

  let wasConnected = false;
  const render = (): void => {
    if (disposed) return;
    // The Curriculum outlet was torn down (surface switch, sign-out,
    // account change): stop rendering and release the controller.
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) {
      dispose();
      return;
    }
    const s = controller.getState();
    for (const [g, b] of gradeButtons) {
      const active = g === s.grade;
      b.setAttribute("aria-pressed", active ? "true" : "false");
      b.classList.toggle("shell-filter-pill-active", active);
    }
    archivedBox.checked = s.showArchived;
    renderCreate(s);
    renderList(s);
  };

  const unsubscribe = controller.subscribe(render);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    controller.dispose();
  };
  render();
  return Object.freeze({ dispose });
}
