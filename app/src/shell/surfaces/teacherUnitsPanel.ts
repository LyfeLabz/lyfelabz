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
  type TeacherUnitsViewState,
  type UnitMutationResult,
} from "../../teacherUnits/unitsController";

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

type CardView = {
  readonly li: HTMLLIElement;
  unit: TeacherUnit;
  // The server no longer returns this unit (deleted or another school).
  gone: boolean;
  editor: EditorView | null;
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
    el("p", "shell-units-intro", "Create your own units for each grade. Adding resources to units comes later."),
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
  const announce = (msg: string): void => {
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
            `"${a.title}" (${gradeLabel(a.grade)})${started ? `, started ${started}` : ""}`,
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
    if (count > prevFormerCount) {
      announce(
        count === 1
          ? "One unconfirmed unit request from a previous school is listed in My Units."
          : `${count} unconfirmed unit requests from a previous school are listed in My Units.`,
      );
    }
    prevFormerCount = count;
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

  const showNotice = (card: CardView, msg: string | null, kind: "conflict" | "error" = "error"): void => {
    card.notice.hidden = msg === null;
    card.notice.textContent = msg ?? "";
    card.notice.className = `shell-units-notice shell-units-notice--${kind}`;
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

  const renderCardBody = (card: CardView): void => {
    const u = card.unit;
    const busy = controller.getState().busyUnitIds.has(u.unitId);
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
        const actions = el("div", "shell-units-actions");
        if (u.status === "active") {
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
    return { li, unit, gone: false, editor: null, notice, body };
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
