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
  type ResourceMoveDirection,
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
import type { TeacherUnitError } from "../../teacherUnits/errors";
import type { UnresolvedCreateReason } from "../../teacherUnits/saveCoordination";

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
  // What the card's notice says, kept so it can be reworded for where the
  // unit is when the notice moves to the panel's outcome region.
  noticeText: NoticeText | null;
  readonly notice: HTMLParagraphElement;
  readonly body: HTMLDivElement;
  // U2.5: what the body was last built from (see `renderCardBody`), and the
  // picker options' inputs (see `renderPickerOptions`).
  rendered: {
    readonly unit: TeacherUnit;
    readonly gone: boolean;
    readonly editor: EditorView | null;
    readonly picker: PickerView | null;
    readonly confirmRetired: number | null;
    readonly where: string | null;
  } | null;
  pickerKey: { readonly unit: TeacherUnit; readonly search: string } | null;
};

// Where a unit stands for the teacher right now, derived from the current
// accepted state and view on every render (never stored).
type NoticeContext = {
  // Where to check the unit's resources, or null while its card is listed.
  readonly where: string | null;
  readonly archived: boolean;
  // The newest evidence says the unit exists and is active.
  readonly active: boolean;
  // The newest evidence says the unit is not in the teacher's units.
  readonly absent: boolean;
  readonly listed: boolean;
  // The latest accepted record while the newest evidence says the unit
  // exists (active or archived), else null. Never an older snapshot.
  readonly unit: TeacherUnit | null;
};
// History is immutable. Current values and instructions belong exclusively
// to `present`, evaluated from accepted evidence at presentation time.
// The same descriptor is used by cards, durable entries and shared status.
type NoticeText = {
  readonly historical: string;
  readonly present?: (ctx: NoticeContext) => string;
};
const historicalNotice = (historical: string): NoticeText => ({ historical });
const contextualNotice = (historical: string, present: (ctx: NoticeContext) => string): NoticeText =>
  ({ historical, present });

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
  // U2.5 focus rules (TEACHER_UNITS.md "U2.5"). Focus only ever moves to a
  // connected, enabled, visible element; a detached or disabled target is
  // skipped, never "focused" into the void.
  const canFocus = (t: HTMLElement | null): boolean =>
    t !== null && t.isConnected && !(t as HTMLButtonElement).disabled && t.closest("[hidden]") === null;
  const focus = (target: HTMLElement | null): boolean => {
    if (target === null || !canFocus(target)) return false;
    try {
      target.focus({ preventScroll: false });
    } catch {
      return false;
    }
    return doc.activeElement === target;
  };
  const focusFirst = (...targets: ReadonlyArray<HTMLElement | null>): boolean => {
    for (const t of targets) if (focus(t)) return true;
    return false;
  };
  // Pending and edge controls stay focusable (aria-disabled); activation is
  // refused by one capturing guard on the panel (see below).
  const isInert = (b: HTMLElement): boolean =>
    (b as HTMLButtonElement).disabled === true || b.getAttribute("aria-disabled") === "true";
  const setAriaDisabled = (b: HTMLElement, off: boolean): void => {
    if (off) {
      if (b.getAttribute("aria-disabled") !== "true") b.setAttribute("aria-disabled", "true");
    } else if (b.hasAttribute("aria-disabled")) b.removeAttribute("aria-disabled");
  };
  // Rebuild `container` and, when focus was inside it, return focus to the
  // control with the same test id (or to `fallback`, given that test id).
  const rebuildKeepingFocus = (
    container: HTMLElement,
    build: () => void,
    fallback: (tid: string | null) => HTMLElement | null,
  ): void => {
    const active = doc.activeElement as HTMLElement | null;
    const inside = active !== null && container.contains(active);
    const tid = inside ? active.getAttribute("data-testid") : null;
    container.textContent = "";
    build();
    if (!inside) return;
    const same = tid ? container.querySelector<HTMLElement>(`[data-testid="${tid}"]`) : null;
    focusFirst(same, fallback(tid));
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
  // U2.5 Check for changes: the controller's own list read (`refresh`),
  // which accepts only evidence newer than what is held. Never a page
  // reload, never a replay of an unconfirmed change.
  const checkChanges = button("Check for changes");
  checkChanges.setAttribute("data-testid", "units-check-changes");
  toolbar.appendChild(checkChanges);
  let checking = false;

  // One guard for every aria-disabled control (pending, or a list edge):
  // it stays focusable, and a click, Enter, or Space does nothing.
  root.addEventListener(
    "click",
    (ev) => {
      const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>('[aria-disabled="true"]') : null;
      if (t !== null && root.contains(t)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true,
  );
  // Focus parked by the panel after a card left the list. The operation
  // that started in that card still owns it until the teacher moves on.
  let parked: { readonly unitId: string; readonly el: Element } | null = null;
  root.addEventListener("focusin", (ev) => {
    if (parked !== null && ev.target !== parked.el) parked = null;
  });

  // One polite live region for confirmations.
  const status = el("p", "shell-units-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("data-testid", "units-status");
  root.appendChild(status);
  // Outcome region: outcomes for units whose card is not shown (archived
  // and hidden, refreshed away, or no longer found), which would otherwise
  // be lost with the card or overwritten in the shared status region.
  // Policy: every settled operation adds its OWN entry (a stable operation
  // id); no entry is replaced by another operation's outcome, for the same
  // unit or another; Dismiss removes only its entry. Problems (refusals,
  // conflicts, unknown outcomes) are alerts and are never evicted;
  // confirmations are polite status entries, and only the oldest of those
  // is evicted beyond OUTCOMES_MAX. The panel is torn down on any teacher or
  // school change, so entries never carry across accounts or schools.
  const OUTCOMES_MAX = 8;
  const outcomes = el("div", "shell-units-outcomes");
  outcomes.setAttribute("data-testid", "units-outcomes");
  root.appendChild(outcomes);
  let outcomeSeq = 0;
  // Each entry keeps its operation's facts (id, unit, kind, historical
  // wording or formatter); only the wording derived from the current state
  // is refreshed (see `refreshNotices`), in place, without a new entry.
  type OutcomeEntry = {
    readonly unitId: string;
    readonly fallbackTitle: string;
    readonly text: NoticeText;
    readonly box: HTMLElement;
    readonly message: HTMLParagraphElement;
    readonly dismiss: HTMLButtonElement;
  };
  const entries = new Map<HTMLElement, OutcomeEntry>();
  const entryText = (e: OutcomeEntry): string => {
    const title = controller.getKnownUnit(e.unitId)?.title ?? e.fallbackTitle;
    return `"${title}": ${wordNotice(e.text, e.unitId)}`;
  };
  // Removes one entry; when focus was inside it, focus moves to the next
  // remaining entry's Dismiss (else the previous one's, else the heading).
  const removeEntry = (box: HTMLElement, moveFocus: boolean): void => {
    const sibling = (box.nextElementSibling ?? box.previousElementSibling) as HTMLElement | null;
    const next = sibling !== null ? entries.get(sibling)?.dismiss ?? null : null;
    const hadFocus = moveFocus || box.contains(doc.activeElement);
    box.remove();
    entries.delete(box);
    if (hadFocus) focus(next ?? heading);
  };
  const recordOutcome = (
    unitId: string,
    fallbackTitle: string,
    text: NoticeText,
    kind: "conflict" | "error" | "confirmed",
  ): void => {
    const id = ++outcomeSeq;
    const box = el(
      "div",
      kind === "confirmed" ? "shell-units-notice shell-units-outcome--confirmed" : `shell-units-notice shell-units-notice--${kind}`,
    );
    box.setAttribute("role", kind === "confirmed" ? "status" : "alert");
    box.setAttribute("data-testid", `units-outcome-${id}`);
    box.setAttribute("data-outcome-kind", kind);
    box.setAttribute("data-unit-id", unitId);
    const message = el("p", "");
    box.appendChild(message);
    const dismiss = button("Dismiss");
    dismiss.setAttribute("data-testid", `units-outcome-dismiss-${id}`);
    dismiss.addEventListener("click", () => removeEntry(box, true));
    box.appendChild(dismiss);
    const entry: OutcomeEntry = { unitId, fallbackTitle, text, box, message, dismiss };
    entries.set(box, entry);
    message.textContent = entryText(entry);
    dismiss.setAttribute("aria-label", `Dismiss notice about ${controller.getKnownUnit(unitId)?.title ?? fallbackTitle}`);
    outcomes.appendChild(box);
    const confirmations = Array.from(outcomes.querySelectorAll<HTMLElement>('[data-outcome-kind="confirmed"]'));
    if (outcomes.children.length > OUTCOMES_MAX && confirmations.length > 0) removeEntry(confirmations[0], false);
  };
  // Which pending membership request owns the current message (0: none).
  let statusOwner = 0;
  // The status region's confirmation when its wording says where the unit
  // is: re-derived like retained notices (see `refreshNotices`) while it is
  // still the message showing. Any other announcement replaces it.
  let statusNotice: { readonly unitId: string; readonly text: NoticeText; shown: string } | null = null;
  const announce = (msg: string): void => {
    statusOwner = 0;
    statusNotice = null;
    if (status.textContent !== msg) status.textContent = msg;
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

  // aria-invalid and aria-describedby for a field and its error message.
  const markInvalid = (control: HTMLInputElement | HTMLTextAreaElement, error: HTMLElement | null): void => {
    if (error === null) {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
      return;
    }
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", error.id);
  };
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
  createError.id = uid("create-error");
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
  // `field` names the control the message is about (validation only); that
  // control is marked invalid and described by the message.
  const showCreateError = (msg: string | null, field: "title" | "description" | null = null): void => {
    shownError = msg;
    createError.hidden = msg === null;
    if (createError.textContent !== (msg ?? "")) createError.textContent = msg ?? "";
    markInvalid(createTitle, msg !== null && field === "title" ? createError : null);
    markInvalid(createDescription, msg !== null && field === "description" ? createError : null);
  };

  createForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (isInert(createSubmit)) return;
    const s = controller.getState();
    const titleMsg = validateUnitTitle(createTitle.value);
    const descMsg = validateUnitDescription(createDescription.value);
    if (titleMsg !== null || descMsg !== null) {
      showCreateError(titleMsg ?? descMsg, titleMsg !== null ? "title" : "description");
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
      msg.textContent = `"${title}" (${gradeLabel(grade)}): ${createUnresolved(st.reason)}`;
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
          recovery.appendChild(el("p", "shell-units-error", readFailure(s.recoveryCheck.error, "check")));
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
    // While the request is pending, the fields are read-only and the submit
    // is aria-disabled, so the control the teacher used keeps focus. Every
    // other lock (unconfirmed requests first) disables them.
    const pending = create.kind === "inFlight";
    const blocked = locked && !pending;
    createTitle.disabled = blocked;
    createDescription.disabled = blocked;
    createTitle.readOnly = pending;
    createDescription.readOnly = pending;
    createSubmit.disabled = blocked;
    setAriaDisabled(createSubmit, pending);
    createSubmit.setAttribute("aria-busy", pending ? "true" : "false");
    createSubmit.textContent = create.kind === "inFlight" ? "Creating..." : `Create ${gradeLabel(s.grade)} unit`;

    const blockedMsg = s.createBlocked !== null ? BLOCKED_MESSAGES[s.createBlocked] ?? null : null;
    if (create.kind === "rejected") {
      const f = create.error.field;
      showCreateError(createRejected(create.error), f === "title" || f === "description" ? f : null);
    }
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
        announce(createUnresolved(create.reason));
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

  // ---------- Focus ownership (U2.5) ----------
  //
  // An asynchronous operation may move focus when it settles only while the
  // focus is still its own: inside its card, parked by the panel when its
  // card left the list, or lost (the body). A teacher who moved on keeps
  // their focus.
  const owns = (card: CardView): boolean => {
    const a = doc.activeElement;
    if (a === null || a === doc.body) return true;
    if (card.li.isConnected && card.li.contains(a)) return true;
    return parked !== null && parked.unitId === card.unit.unitId && parked.el === a;
  };
  const latestDismissFor = (unitId: string): HTMLElement | null => {
    let found: HTMLElement | null = null;
    for (const e of entries.values()) if (e.unitId === unitId) found = e.dismiss;
    return found;
  };
  // A card's main action: its first available unit-level button (Add
  // resources, Edit, Archive, or Restore), else its first available button.
  const cardAction = (card: CardView): HTMLElement | null => {
    if (!card.li.isConnected) return null;
    const actions = card.body.querySelectorAll<HTMLElement>(":scope > .shell-units-actions button");
    for (const b of Array.from(actions)) if (canFocus(b)) return b;
    for (const b of Array.from(card.li.querySelectorAll<HTMLElement>("button"))) if (canFocus(b)) return b;
    return null;
  };
  const settleFocus = (card: CardView, ...targets: ReadonlyArray<HTMLElement | null>): void => {
    if (!owns(card)) return;
    if (!card.li.isConnected) {
      // Its card left; the departure already chose a destination. Only lost
      // focus is placed again.
      const a = doc.activeElement;
      if (a === null || a === doc.body) focusFirst(latestDismissFor(card.unit.unitId), heading);
      return;
    }
    focusFirst(...targets, cardAction(card));
  };
  // A card holding focus is leaving the list: focus the card now at its
  // position (else the one before it), else this unit's newest notice in the
  // outcome region, else the heading. The destination stays owned by the
  // departing unit's pending operation until the teacher moves.
  const departFocus = (unitId: string, index: number): void => {
    const remaining = Array.from(list.children)
      .map((li) => cards.get(li.getAttribute("data-unit-id") ?? ""))
      .filter((c): c is CardView => c !== undefined && c.unit.unitId !== unitId);
    const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
    focusFirst(next !== null ? cardAction(next) : null, latestDismissFor(unitId), heading);
    parked = { unitId, el: doc.activeElement as Element };
  };

  const closeEditor = (card: CardView, focusEdit: boolean): void => {
    const hadFocus = card.li.contains(doc.activeElement);
    card.editor?.form.remove();
    card.editor = null;
    if (!cards.has(card.unit.unitId) || !isListed(card.unit.unitId)) {
      // A pinned card (kept only for its editor) leaves with the editor.
      const index = Array.prototype.indexOf.call(list.children, card.li);
      card.li.remove();
      cards.delete(card.unit.unitId);
      if (focusEdit || hadFocus) departFocus(card.unit.unitId, index);
      return;
    }
    renderCardBody(card);
    if (focusEdit) focusFirst(card.li.querySelector<HTMLButtonElement>("[data-action=edit]"));
  };

  const isListed = (unitId: string): boolean => {
    const s = controller.getState();
    return s.list.kind === "ready" && s.list.units.some((u) => u.unitId === unitId);
  };

  // A unit's outcome notice: in its card while the card is attached, else
  // a new entry in the outcome region (never a detached card). Clearing
  // (null) clears only the card's own notice, never another operation's
  // entry in the outcome region.
  const showNotice = (card: CardView, text: NoticeText | null, kind: "conflict" | "error" = "error"): void => {
    const unitId = card.unit.unitId;
    const attached = text !== null && card.li.isConnected;
    card.noticeText = attached ? text : null;
    card.notice.hidden = !attached;
    card.notice.textContent = attached ? wordNotice(text as NoticeText, unitId) : "";
    card.notice.className = `shell-units-notice shell-units-notice--${kind}`;
    if (text !== null && !attached) {
      recordOutcome(unitId, card.unit.title, text, kind);
    }
  };
  // A card leaving the list hands its visible notice to the outcome
  // region, reworded for where the unit is now.
  const keepNotice = (card: CardView): void => {
    if (card.notice.hidden || card.noticeText === null) return;
    const kind = card.notice.className.includes("--conflict") ? "conflict" : "error";
    recordOutcome(card.unit.unitId, card.unit.title, card.noticeText, kind);
    card.noticeText = null;
  };

  // `base` is the revision the request was based on (the held record when it
  // was made), so a conflict never presents that older record as current.
  const VERB: Readonly<Record<LifecycleOp, string>> = Object.freeze({
    edit: "Saved",
    archive: "Archived",
    restore: "Restored",
  });
  const handleResult = (card: CardView, result: UnitMutationResult, op: LifecycleOp, base: number): void => {
    if (disposed || result.kind === "stale") return;
    // Acceptance can settle while list rendering is unavailable. Reconcile
    // presentation explicitly; the controller's verified contract stays intact.
    render();
    switch (result.kind) {
      case "saved":
        showNotice(card, null);
        announce(result.noop ? "This request made no changes." : `${VERB[op]}: "${result.unit.title}".`);
        return;
      case "invalid":
        if (card.editor) {
          const target = result.field === "title" ? card.editor.title : card.editor.description;
          card.editor.error.hidden = false;
          card.editor.error.textContent = result.message;
          markInvalid(card.editor.title, result.field === "title" ? card.editor.error : null);
          markInvalid(card.editor.description, result.field === "description" ? card.editor.error : null);
          settleFocus(card, target);
        }
        return;
      case "conflict":
        showNotice(card, conflictNotice(card, "edit", result.latest, base), "conflict");
        return;
      case "archived":
        showNotice(
          card,
          contextualNotice(
            "This unit was archived, so your changes weren't saved.",
            (ctx) => sentences([
              card.editor !== null ? "Your edits are still here." : null,
              afterArchivedRefusal(
                ctx,
                card.editor !== null ? "Restore the unit to save them, or cancel to discard them." : "Restore it to make changes.",
                card.editor !== null ? "It is active again, so you can save them again." : "It is active again.",
              ).trim(),
            ]),
          ),
          "conflict",
        );
        return;
      case "error":
      case "uncertain":
        showNotice(card, failureNotice(result.error, { card, op, base }));
        return;
      case "busy":
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
    error.id = uid("edit-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    form.appendChild(error);
    const actions = el("div", "shell-units-actions");
    const save = button("Save", "primary");
    save.type = "submit";
    save.setAttribute("data-testid", `units-edit-save-${card.unit.unitId}`);
    save.setAttribute("data-busy-gate", "");
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
      if (isInert(save)) return;
      error.hidden = true;
      markInvalid(title, null);
      markInvalid(description, null);
      const base = baseOf(card);
      void controller
        .updateUnit(card.unit.unitId, { title: title.value, description: description.value })
        .then((result) => {
          handleResult(card, result, "edit", base);
          if (result.kind === "saved" && card.editor === editor) closeEditor(card, owns(card));
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
  // later change needs a record newer than this operation established;
  // its author or location is never inferred from the revision alone.
  // Display availability and accepted evidence are independent. A pinned
  // editor is visible even when its unit is outside the filtered list.
  const whereNow = (unitId: string): string | null => {
    const st = controller.getUnitState(unitId);
    const view = controller.getState();
    if (st.kind === "absent") return "This unit is no longer in your units.";
    if (st.kind !== "active" && st.kind !== "archived") {
      return "This unit's current state hasn't been confirmed. Choose Check for changes to see it.";
    }
    const card = cards.get(unitId);
    const editorOpen = card?.editor != null;
    if (st.unit.grade !== view.grade) {
      return `This is a ${gradeLabel(st.unit.grade)} unit, so it isn't in the ${gradeLabel(view.grade)} list.${editorOpen ? " Its editor is still open." : ""} Choose ${gradeLabel(st.unit.grade)} to see it in the list.`;
    }
    if (st.kind === "archived" && !view.showArchived) {
      return `This unit is archived, so it isn't in the list.${editorOpen ? " Its editor is still open." : ""} Turn on Show archived units to see its resources in the list.`;
    }
    if (card?.li.isConnected && !card.gone && card.unit === st.unit) return null;
    if (view.list.kind === "loading") return "The unit list is loading. These details are from the latest version LyfeLabz has loaded.";
    if (view.list.kind === "error") return "The unit list couldn't be refreshed. These details are from the latest version LyfeLabz has loaded.";
    return isListed(unitId) ? null : "This unit isn't in your current list. Choose Check for changes to see its resources.";
  };
  const contextOf = (unitId: string): NoticeContext => {
    const st = controller.getUnitState(unitId);
    return {
      where: whereNow(unitId),
      archived: st.kind === "archived",
      active: st.kind === "active",
      absent: st.kind === "absent",
      listed: cards.get(unitId)?.li.isConnected === true && cards.get(unitId)?.gone === false &&
        (st.kind === "active" || st.kind === "archived") && st.unit.grade === controller.getState().grade &&
        (st.kind === "active" || controller.getState().showArchived),
      unit: st.kind === "active" || st.kind === "archived" ? st.unit : null,
    };
  };
  const sentences = (parts: ReadonlyArray<string | null>): string =>
    parts.filter((x): x is string => x !== null && x !== "").join(" ");
  const wordNotice = (text: NoticeText, unitId: string, ctx?: NoticeContext): string =>
    sentences([text.historical, text.present?.(ctx ?? contextOf(unitId)) ?? null]);
  const afterArchivedRefusal = (ctx: NoticeContext, stillArchived: string, activeAgain: string): string => {
    const parts = ctx.archived
      ? [ctx.where, stillArchived]
      : ctx.active
        ? ctx.where === null ? [activeAgain] : ["It is active again.", ctx.where]
        : [ctx.where];
    const text = sentences(parts);
    return text === "" ? "" : ` ${text}`;
  };
  const UNCERTAIN_HISTORY = "LyfeLabz couldn't confirm whether your change was saved.";
  const uncertainNext = (ctx: NoticeContext): string =>
    sentences([
      ctx.where ?? "The resources shown are the latest version LyfeLabz has loaded.",
      ctx.active ? "Check them before trying again." : ctx.archived ? "Restore it before making further changes." : null,
    ]);
  const UNCERTAIN: NoticeText = contextualNotice(UNCERTAIN_HISTORY, uncertainNext);
  const uncertainUnread = (base: number): NoticeText => contextualNotice(UNCERTAIN_HISTORY, (ctx) =>
    (ctx.unit !== null && ctx.unit.revision > base) || ctx.absent
      ? uncertainNext(ctx)
      : sentences(["The unit couldn't be loaded after that request.", ctx.where, ctx.archived ? "Restore it before making further changes." : ctx.active ? "Choose Check for changes before trying again." : null]),
  );
  type Saved = Extract<UnitMutationResult, { kind: "saved" }>;
  const baseRevision = (result: Saved): number => result.committed?.revision ?? result.unit.revision;

  // Capture operation evidence only. Present membership is evaluated anew
  // by the same presenter for initial announcement and every retained view.
  const membershipOutcome = (
    result: Saved,
    action: "add" | "remove" | "repair" | "move",
    targets: ReadonlyArray<string>,
    name: string,
    count: number,
    // U2.4 move only: the 1-based position the request placed the resource
    // at, and the list length, from the committed (or no-op) list.
    position?: { readonly at: number; readonly of: number },
  ): NoticeText => {
    const title = result.unit.title;
    const write = !result.noop;
    const revision = baseRevision(result);
    const at = position?.at ?? 0;
    const of = position?.of ?? 0;
    const positionNow = (u: TeacherUnit): string => {
      const i = u.resourceIds.indexOf(targets[0]);
      return i === -1
        ? `"${name}" isn't in "${u.title}" now.`
        : `"${name}" is at position ${i + 1} of ${u.resourceIds.length} in "${u.title}" now`;
    };
    const agrees = (u: TeacherUnit): boolean => action === "add"
      ? targets.every(id => u.resourceIds.includes(id))
      : action === "remove" ? !u.resourceIds.includes(targets[0])
      : action === "move" ? u.resourceIds.indexOf(targets[0]) === at - 1 && u.resourceIds.length === of
      : retiredCount(u) === 0;
    const fact = !write ? "Nothing was changed."
      : action === "add" ? `Added ${plural(count, "resource", "resources")} to "${title}".`
      : action === "remove" ? `Removed "${name}" from "${title}".`
      : action === "move" ? `Moved "${name}" to position ${at} of ${of}.`
      : `Removed ${plural(count, "unavailable resource", "unavailable resources")} from "${title}".`;
    return contextualNotice(fact, ctx => {
      const cur = ctx.unit;
      if (cur === null) return ctx.where ?? "This unit's current state hasn't been confirmed.";
      const same = agrees(cur);
      const newer = cur.revision > revision;
      const membership = same
        ? write ? null
          : action === "add" ? `Those resources are already in "${cur.title}" now.`
          : action === "remove" ? `"${name}" isn't in "${cur.title}" now.`
          : action === "move" ? `${positionNow(cur)}.`
          : `"${cur.title}" has no unavailable resources now.`
        : !newer ? "LyfeLabz can't tell yet whether this request took effect. Choose Check for changes to see."
          : action === "move" ? (cur.resourceIds.includes(targets[0]) ? `${positionNow(cur)}, after this unit changed.` : positionNow(cur))
          : action === "add" ? `"${cur.title}" changed since that request, so not every resource you ${write ? "added" : "chose"} is in it now.`
          : action === "remove" ? `"${name}" is in "${cur.title}"${write ? " again" : ""} after this unit changed.`
          : `"${cur.title}" has unavailable resources${write ? " again" : ""} after it changed.`;
      return sentences([
        !same && write && newer ? "Your change was saved." : null,
        membership,
        cur.title !== title ? `Its latest loaded name is "${cur.title}".` : null,
        ctx.archived ? `"${cur.title}" is archived.` : null,
        ctx.where,
        !same && ctx.listed ? "Its current resources are shown." : null,
      ]);
    });
  };
  const removeOutcome = (result: Saved, resourceId: string, name: string): NoticeText =>
    membershipOutcome(result, "remove", [resourceId], name, 1);
  const addOutcome = (result: Saved, ids: ReadonlyArray<string>): NoticeText => {
    const commit = result.committed;
    const targets = !result.noop && commit !== undefined
      ? commit.resourceIds.filter(id => !commit.previous.includes(id)) : ids.slice();
    return membershipOutcome(result, "add", targets, "", targets.length);
  };
  // Position facts come from the committed list (what this write did); a
  // no-op reports the list the server already held.
  const moveOutcome = (result: Saved, resourceId: string, name: string): NoticeText => {
    const list = !result.noop && result.committed !== undefined ? result.committed.resourceIds : result.unit.resourceIds;
    const at = list.indexOf(resourceId) + 1;
    return membershipOutcome(result, "move", [resourceId], name, 1, { at, of: list.length });
  };
  const repairOutcome = (result: Saved, before: ReadonlySet<string>): NoticeText => {
    const commit = result.committed;
    const removed = commit !== undefined
      ? commit.previous.filter(id => isUnavailable(id) && !commit.resourceIds.includes(id)).length : before.size;
    return membershipOutcome(result, "repair", [], "", removed);
  };
  const showOutcome = (card: CardView, text: NoticeText): void => {
    render();
    showNotice(card, null);
    const unitId = card.unit.unitId;
    announce(wordNotice(text, unitId));
    statusNotice = { unitId, text, shown: status.textContent ?? "" };
    if (!card.li.isConnected || !isListed(unitId)) recordOutcome(unitId, card.unit.title, text, "confirmed");
  };

  // ---------- Historical facts and current contextual presentation ----------
  //
  // A retained notice states what happened, fixed when its operation
  // settled, and derives everything about the unit now (its name and
  // description, whether it holds unavailable resources, where it is) from
  // the latest accepted record on every render. Nothing fixed at settlement
  // says what the unit holds now or whether this account can make changes
  // now.

  // The revision a request is based on: the record held when it was made.
  const baseOf = (card: CardView): number => controller.getKnownUnit(card.unit.unitId)?.revision ?? -1;

  // A revision conflict. The record the request was based on is known to be
  // older than the server's, so values are named only from the latest
  // accepted record, and only once it is the reconciliation read (`latest`)
  // or newer, or (when that read failed) newer than the base. The next step
  // follows where the unit stands now.
  const conflictNotice = (
    card: CardView,
    what: "edit" | "add" | "remove" | "move",
    latest: TeacherUnit | null,
    base: number,
  ): NoticeText => {
    const min = latest !== null ? latest.revision : base + 1;
    const outcome =
      what === "edit"
        ? "This unit changed since it was loaded here, so your change wasn't saved."
        : `This unit changed since it was loaded here, so ${what === "add" ? "nothing was added" : what === "move" ? "nothing was moved" : "nothing was removed"}.`;
    return contextualNotice(outcome, (ctx) => {
      const loaded = ctx.unit !== null && ctx.unit.revision >= min ? ctx.unit : null;
      const editing = what === "edit" && card.editor !== null;
      const values =
        what === "edit" && loaded !== null
          ? `The latest version LyfeLabz has loaded is named "${loaded.title}" and has ${
              loaded.description.length > 0 ? `the description "${loaded.description}"` : "no description"
            }.`
          : null;
      const unread = latest === null && loaded === null && !ctx.absent ? "Its latest version couldn't be loaded." : null;
      let next: ReadonlyArray<string | null>;
      if (ctx.archived) {
        next = [
          ctx.where ?? "It is archived now.",
          editing
            ? "Your edits are still here. Restore it to save them, or cancel to discard them."
            : what === "edit"
              ? "Restore it to make changes."
              : "Restore it to change its resources.",
        ];
      } else if (ctx.active && loaded === null) {
        next = [ctx.where ?? "Choose Check for changes, then try again."];
      } else if (ctx.active) {
        next = editing
          ? [ctx.where, "Your edits are still here. Review them, then save again."]
          : what === "edit"
            ? [ctx.where, "Review it, then try again."]
            : [ctx.where ?? "Its current resources are shown. Review them, then try again."];
      } else {
        next = [ctx.where];
      }
      return sentences([values, unread, ...next]);
    });
  };

  // The next step after a notice about unavailable resources, from the
  // latest accepted record: remove them only while it still holds some,
  // restore first while it is archived, and no step at all for a unit that
  // is not in the teacher's units (or not known now). Never claims that a
  // repair happened, only what the record holds.
  const retiredNext = (ctx: NoticeContext, again: string | null): Array<string | null> => {
    if (ctx.archived) return [ctx.where ?? "It is archived now.", "Restore it to change its resources."];
    if (ctx.active && ctx.unit !== null) {
      return retiredCount(ctx.unit) > 0
        ? [ctx.where, `Remove the unavailable resources first, then ${again ?? "try again."}`]
        : [again !== null ? `It has no unavailable resources now, so you can ${again}` : "It has no unavailable resources now.", ctx.where];
    }
    return [ctx.where];
  };
  // The picker closed because unavailable resources arrived (historical).
  const PICKER_RETIRED: NoticeText = contextualNotice(
    "Some resources in this unit were no longer available, so adding resources was closed.",
    ctx => sentences(retiredNext(ctx, "add resources again.")),
  );
  // U2.5: an unconfirmed edit, archive, or restore says what may not have
  // happened, never anything about resources. What the unit holds now comes
  // only from a record newer than the request's base.
  type LifecycleOp = "edit" | "archive" | "restore";
  const UNCONFIRMED_OP: Readonly<Record<LifecycleOp, string>> = Object.freeze({
    edit: "LyfeLabz couldn't confirm whether your changes were saved.",
    archive: "LyfeLabz couldn't confirm whether this unit was archived.",
    restore: "LyfeLabz couldn't confirm whether this unit was restored.",
  });
  const uncertainLifecycle = (card: CardView, op: LifecycleOp, base: number): NoticeText =>
    contextualNotice(UNCONFIRMED_OP[op], (ctx) => {
      const newer = ctx.unit !== null && ctx.unit.revision > base;
      const editing = op === "edit" && card.editor !== null ? "Your edits are still here." : null;
      if (ctx.absent || ctx.unit === null) return sentences([editing, ctx.where]);
      if (!newer) {
        return sentences([
          editing,
          ctx.where,
          op === "edit"
            ? "Choose Check for changes to see whether they were saved before trying again."
            : `Choose Check for changes to see whether it was ${op === "archive" ? "archived" : "restored"}.`,
        ]);
      }
      const now = op === "edit"
        ? `The latest version LyfeLabz has loaded is named "${ctx.unit.title}".`
        : ctx.archived ? "It is archived now." : "It is active now.";
      return sentences([now, editing, ctx.where]);
    });
  const failureNotice = (
    error: TeacherUnitError,
    lifecycle?: { readonly card: CardView; readonly op: LifecycleOp; readonly base: number },
  ): NoticeText => {
    if (lifecycle !== undefined && (error.category === "network" || error.category === "unexpected")) {
      return uncertainLifecycle(lifecycle.card, lifecycle.op, lifecycle.base);
    }
    switch (error.category) {
      case "unauthorized":
        return contextualNotice(
          "An authorization check failed during this request, so LyfeLabz couldn't confirm whether your change was saved.",
          ctx => sentences([
            ctx.absent ? null : "If you still can't make changes, sign in again.",
            ctx.where ?? "Check this unit before trying again.",
          ]),
        );
      case "notFound":
        return contextualNotice("LyfeLabz couldn't find this unit when you tried.", ctx => sentences([
          ctx.unit !== null ? "It was found in your units again." : null, ctx.where,
        ]));
      case "resourceRejected":
        if (error.code === "teacherUnits.duplicateResource") {
          return historicalNotice("The request contained repeated resource IDs, so nothing was changed.");
        }
        return contextualNotice(
          "Your change wasn't saved because it named resources that are no longer available.",
          ctx => sentences(retiredNext(ctx, null)),
        );
      case "network":
      case "unexpected":
        return UNCERTAIN;
      default:
        return contextualNotice("This request couldn't be completed.", ctx =>
          sentences([ctx.where, ctx.active ? "Review the unit before trying again." : ctx.archived ? "Restore it before making changes." : null]),
        );
    }
  };
  // Read errors never borrow the normalizer's uncertain-write wording.
  const readFailure = (error: TeacherUnitError, what: "list" | "check"): string => {
    const history = what === "list" ? "Your units couldn't be loaded" : "LyfeLabz couldn't check your units";
    if (error.category === "unauthorized") {
      return `${history} because an authorization check failed when LyfeLabz tried. If this keeps happening, sign in again, then try again.`;
    }
    if (error.category === "limitExceeded") return error.message;
    return `${history}. ${error.category === "network" ? "Check your connection, then try again." : "Try again."}`;
  };
  // U2.5 create wording, owned here so it is one LyfeLabz voice with no
  // request-mechanics language. Every unconfirmed reason says the unit may
  // exist; none suggests creating it again before checking.
  const UNCONFIRMED_CREATE = "LyfeLabz couldn't confirm whether this unit was created.";
  const CHECK_BEFORE_CREATING = "Choose Check my units to see whether it already exists before creating a different unit.";
  const createUnresolved = (reason: UnresolvedCreateReason): string => {
    switch (reason) {
      case "uncertain":
      case "contention":
      case "notFound":
        return `${UNCONFIRMED_CREATE} Choose Check again. Checking again can't create a second copy of this unit.`;
      case "unauthorized":
        return `${UNCONFIRMED_CREATE} If this keeps happening, sign in again. Then choose Check again. Checking again can't create a second copy of this unit.`;
      case "idempotencyKeyConflict":
        return `${UNCONFIRMED_CREATE} ${CHECK_BEFORE_CREATING}`;
      case "replayExpired":
        return `${UNCONFIRMED_CREATE} This request is too old to check again safely. ${CHECK_BEFORE_CREATING}`;
      case "replayRefused":
        return `${UNCONFIRMED_CREATE} This request can't be checked again. ${CHECK_BEFORE_CREATING}`;
      case "schoolContextChanged":
        return `${UNCONFIRMED_CREATE} Your school changed after you asked for it, so LyfeLabz won't create it at your new school. If it was created, it belongs to your previous school. Reload the page to continue at your current school, and create the unit there only if you still need it.`;
    }
  };
  // A confirmed pre-commit refusal: nothing was created.
  const createRejected = (error: TeacherUnitError): string =>
    error.category === "invalidField"
      ? error.message
      : "LyfeLabz couldn't create this unit, so nothing was saved. Check the unit name and description, then try again.";

  // Notices for a membership request that did not confirm a change.
  const membershipNotice = (
    card: CardView,
    result: UnitMutationResult,
    action: "add" | "remove" | "move",
    base: number,
  ): void => {
    render();
    const nothing = action === "add" ? "nothing was added" : action === "move" ? "nothing was moved" : "nothing was removed";
    switch (result.kind) {
      case "conflict":
        showNotice(card, conflictNotice(card, action, result.latest, base), "conflict");
        return;
      case "archived":
        showNotice(
          card,
          contextualNotice(`This unit was archived, so ${nothing}.`, ctx =>
            afterArchivedRefusal(ctx, "Restore it to change its resources.", "It is active again, so you can try again.").trim()),
          "conflict",
        );
        return;
      case "uncertain":
        showNotice(card, result.latest === null ? uncertainUnread(base) : UNCERTAIN, "conflict");
        return;
      case "error":
        showNotice(card, failureNotice(result.error));
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
    card.pickerKey = null;
    if (card.li.isConnected) renderCardBody(card);
    if (focusAdd) settleFocus(card, addButtonOf(card));
  };

  // Rebuilt only when what the options show changes (the unit record or the
  // search). Busy state is applied in place, so a focused checkbox is never
  // replaced by an unrelated render.
  const renderPickerOptions = (card: CardView): void => {
    const picker = card.picker;
    if (picker === null) return;
    const u = card.unit;
    const h = picker.form.querySelector("h5");
    const label = `Add resources to "${u.title}"`;
    if (h !== null && h.textContent !== label) h.textContent = label;
    const key = card.pickerKey;
    if (key !== null && key.unit === u && key.search === picker.search.value) {
      updatePickerSubmit(card);
      applyBusy(card);
      return;
    }
    card.pickerKey = { unit: u, search: picker.search.value };
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
          box.disabled = inUnit;
          if (!inUnit) box.setAttribute("data-busy-gate", "");
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
    applyBusy(card);
  };

  const updatePickerSubmit = (card: CardView): void => {
    const picker = card.picker;
    if (picker === null) return;
    const busy = controller.getState().busyUnitIds.has(card.unit.unitId);
    const n = picker.selected.size;
    // Nothing chosen, or a unit that can't take resources: disabled.
    // Pending: aria-disabled (applyBusy), so a focused submit keeps focus.
    picker.submit.disabled = n === 0 || pickerBlocked(card) !== null;
    picker.submit.setAttribute("aria-busy", busy ? "true" : "false");
    const text = busy ? "Adding..." : n === 0 ? "Add selected" : `Add selected (${n})`;
    if (picker.submit.textContent !== text) picker.submit.textContent = text;
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
    submit.setAttribute("data-busy-gate", "");
    const cancel = button("Cancel");
    cancel.setAttribute("data-testid", `units-picker-cancel-${u.unitId}`);
    actions.appendChild(submit);
    actions.appendChild(cancel);
    form.appendChild(actions);
    const picker: PickerView = { form, search, options, submit, selected: new Set<string>() };
    card.picker = picker;
    card.pickerKey = null;

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
      if (isInert(submit) || picker.selected.size === 0) return;
      // Canonical registry order, not click order.
      const ids = getPlaceableResources()
        .map((r) => r.id)
        .filter((id) => picker.selected.has(id));
      const unitTitle = card.unit.title;
      const base = baseOf(card);
      const clearPending = announcePending(
        `Adding ${ids.length === 1 ? "1 resource" : `${ids.length} resources`} to "${unitTitle}"...`,
      );
      void controller.addResources(card.unit.unitId, ids).then((result) => {
        if (disposed) return;
        clearPending();
        if (result.kind === "stale" || result.kind === "busy") return;
        if (result.kind === "saved") {
          showOutcome(card, addOutcome(result, ids));
          if (card.picker === picker) closePicker(card, owns(card));
          return;
        }
        membershipNotice(card, result, "add", base);
        if (result.kind === "archived" && card.picker === picker) closePicker(card, owns(card));
        else if (card.picker === picker) {
          renderPickerOptions(card);
          settleFocus(card, picker.submit.disabled ? picker.search : picker.submit);
        } else settleFocus(card, addButtonOf(card));
      });
    });
    card.li.insertBefore(form, card.notice);
    renderCardBody(card);
    renderPickerOptions(card);
    focus(search);
  };

  const removeResource = (card: CardView, resourceId: string, name: string, index: number): void => {
    const unitTitle = card.unit.title;
    const base = baseOf(card);
    const clearPending = announcePending(`Removing "${name}" from "${unitTitle}"...`);
    void controller.removeResource(card.unit.unitId, resourceId).then((result) => {
      if (disposed) return;
      clearPending();
      if (result.kind === "stale" || result.kind === "busy") return;
      const removeOf = (): HTMLElement | null =>
        card.li.querySelector<HTMLElement>(`[data-testid="units-resource-remove-${card.unit.unitId}-${resourceId}"]`);
      if (result.kind === "saved") {
        showOutcome(card, removeOutcome(result, resourceId, name));
        // Focus the resource's row if it is still shown, else the row that
        // took its place, else Add resources.
        const removes = card.li.querySelectorAll<HTMLElement>("[data-action=remove-resource]");
        settleFocus(card, removeOf(), removes[Math.min(index, removes.length - 1)] ?? null, addButtonOf(card));
        return;
      }
      membershipNotice(card, result, "remove", base);
      settleFocus(card, removeOf(), addButtonOf(card));
    });
  };

  // U2.4. One move per click, saved at once; the row moves only when the
  // server's response is accepted. Focus stays on the same resource: the
  // same direction's control, or the opposite one at a boundary.
  const moveTestId = (unitId: string, dir: ResourceMoveDirection, resourceId: string): string =>
    `units-resource-move-${dir}-${unitId}-${resourceId}`;
  const moveFocusTarget = (card: CardView, resourceId: string, dir: ResourceMoveDirection): HTMLElement | null => {
    const unitId = card.unit.unitId;
    const same = card.li.querySelector<HTMLElement>(`[data-testid="${moveTestId(unitId, dir, resourceId)}"]`);
    const other = card.li.querySelector<HTMLElement>(
      `[data-testid="${moveTestId(unitId, dir === "up" ? "down" : "up", resourceId)}"]`,
    );
    if (same !== null && !same.hasAttribute("data-edge")) return same;
    if (other !== null && !other.hasAttribute("data-edge")) return other;
    return same ?? other ??
      card.li.querySelector<HTMLElement>(`[data-testid="units-resource-remove-${unitId}-${resourceId}"]`) ??
      addButtonOf(card);
  };
  const moveResource = (card: CardView, resourceId: string, name: string, dir: ResourceMoveDirection): void => {
    const unitTitle = card.unit.title;
    const base = baseOf(card);
    const clearPending = announcePending(`Moving "${name}" ${dir} in "${unitTitle}"...`);
    void controller.moveResource(card.unit.unitId, resourceId, dir).then((result) => {
      if (disposed) return;
      clearPending();
      if (result.kind === "stale" || result.kind === "busy") return;
      if (result.kind === "saved") {
        showOutcome(card, moveOutcome(result, resourceId, name));
      } else {
        membershipNotice(card, result, "move", base);
      }
      settleFocus(card, moveFocusTarget(card, resourceId, dir));
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
    const base = baseOf(card);
    card.confirmRetired = null;
    const clearPending = announcePending(
      `Removing ${plural(shown, "unavailable resource", "unavailable resources")} from "${u.title}"...`,
    );
    renderCardBody(card);
    // The confirmation's buttons are gone; keep focus in the repair box.
    focusFirst(retiredButtonOf(card));
    void controller.removeRetiredResources(u.unitId).then((result) => {
      if (disposed) return;
      clearPending();
      if (result.kind === "stale" || result.kind === "busy") return;
      if (result.kind === "saved") {
        showOutcome(card, repairOutcome(result, before));
        settleFocus(card, retiredButtonOf(card), addButtonOf(card));
        return;
      }
      membershipNotice(card, result, "remove", base);
      settleFocus(card, retiredButtonOf(card), addButtonOf(card));
    });
  };

  const renderRetiredRepair = (card: CardView, count: number): HTMLElement => {
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
          `${count === 1 ? "1 resource in this unit is" : `${count} resources in this unit are`} no longer available. Remove ${count === 1 ? "it" : "them"} before adding, removing, or reordering other resources.`,
        ),
      );
      const start = button(`Remove ${plural(count, "unavailable resource", "unavailable resources")}`);
      start.setAttribute("data-testid", `units-retired-remove-${u.unitId}`);
      start.setAttribute("data-busy-gate", "");
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
      confirm.setAttribute("data-busy-gate", "");
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

  const renderResources = (card: CardView): HTMLElement => {
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
          if (meta.length > 0) text.appendChild(el("span", "shell-units-resource-meta", meta.join(" · ")));
        } else {
          text.appendChild(el("span", "shell-lesson-resource-title", name));
        }
        li.appendChild(text);
        // U2.4 ordering: only while every resource is placeable (the server
        // refuses any list that still names a retired id) and there is
        // something to reorder. Boundary and pending controls stay focusable
        // (aria-disabled) and ignore activation.
        if (u.status === "active" && entry.status === "available" && retired === 0 && resolved.length > 1) {
          const moves = el("span", "shell-units-resource-moves");
          for (const dir of ["up", "down"] as const) {
            const label = dir === "up" ? "Move up" : "Move down";
            const move = button(label);
            move.setAttribute("data-action", "move-resource");
            move.setAttribute("data-testid", moveTestId(u.unitId, dir, entry.id));
            move.setAttribute("aria-label", `Move ${name} ${dir} in ${u.title}`);
            move.setAttribute("data-busy-gate", "");
            const edge = dir === "up" ? i === 0 : i === resolved.length - 1;
            if (edge) move.setAttribute("data-edge", "");
            move.addEventListener("click", (ev) => {
              if (isInert(move)) {
                ev.preventDefault();
                return;
              }
              moveResource(card, entry.id, name, dir);
            });
            moves.appendChild(move);
          }
          li.appendChild(moves);
        }
        // Retired rows are removed together (below); one at a time would be
        // refused while another retired id remains.
        if (u.status === "active" && entry.status === "available") {
          const remove = button("Remove");
          remove.setAttribute("data-action", "remove-resource");
          remove.setAttribute("data-testid", `units-resource-remove-${u.unitId}-${entry.id}`);
          remove.setAttribute("aria-label", `Remove ${name} from ${u.title}`);
          remove.disabled = retired > 0;
          remove.setAttribute("data-busy-gate", "");
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
      section.appendChild(renderRetiredRepair(card, retired));
    }
    return section;
  };

  // Busy state, applied in place to every pending-gated control of the card
  // (its body, editor, and picker): focusable, aria-disabled, inactive.
  const applyBusy = (card: CardView): void => {
    const busy = controller.getState().busyUnitIds.has(card.unit.unitId);
    const value = busy ? "true" : "false";
    if (card.li.getAttribute("aria-busy") !== value) card.li.setAttribute("aria-busy", value);
    for (const b of Array.from(card.li.querySelectorAll<HTMLElement>("[data-busy-gate]"))) {
      setAriaDisabled(b, busy || b.hasAttribute("data-edge"));
    }
  };

  // The archive and restore controls replace each other; focus follows.
  const counterpartOf = (tid: string | null): string | null => {
    if (tid === null) return null;
    if (tid.startsWith("units-archive-")) return `units-restore-${tid.slice("units-archive-".length)}`;
    if (tid.startsWith("units-restore-")) return `units-archive-${tid.slice("units-restore-".length)}`;
    return null;
  };

  // A card body is rebuilt only when what it shows changes: the unit record
  // (records are replaced, never mutated, so identity is the change), its
  // presence, an editor or picker opening or closing, the unavailable-
  // resource confirmation, or (for a unit no longer listed) where it is.
  // Busy state is applied in place.
  const renderCardBody = (card: CardView): void => {
    const u = card.unit;
    // An open picker follows the current unit: it closes when the unit is
    // archived or now holds unavailable resources (the repair comes first).
    let refocus = false;
    const blocked = card.picker !== null ? pickerBlocked(card) : null;
    if (card.picker !== null && (blocked !== null || card.gone)) {
      refocus = card.picker.form.contains(doc.activeElement);
      card.picker.form.remove();
      card.picker = null;
      card.pickerKey = null;
      if (blocked === "retired") {
        showNotice(card, PICKER_RETIRED, "conflict");
      }
    }
    card.li.classList.toggle("shell-units-card--archived", u.status === "archived");
    const where = card.gone ? whereNow(u.unitId) : null;
    const prev = card.rendered;
    const unchanged =
      prev !== null &&
      prev.unit === u &&
      prev.gone === card.gone &&
      prev.editor === card.editor &&
      prev.picker === card.picker &&
      prev.confirmRetired === card.confirmRetired &&
      prev.where === where;
    if (!unchanged) {
      rebuildKeepingFocus(
        card.body,
        () => {
          if (card.gone && card.editor === null) {
            card.body.appendChild(el("p", "shell-units-recovery-note", where ?? "This unit's current state hasn't been confirmed."));
            return;
          }
          if (card.editor !== null) {
            card.body.appendChild(
              el("p", "shell-units-editing", `Editing "${u.title}" (${gradeLabel(u.grade)})`),
            );
            card.editor.save.disabled = card.gone || u.status !== "active";
            if (card.gone) {
              card.body.appendChild(
                el(
                  "p",
                  "shell-units-notice shell-units-notice--error",
                  `${where} Your changes can't be saved here. Copy anything you need, then cancel.`,
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
              restore.setAttribute("data-busy-gate", "");
              restore.addEventListener("click", () => {
                const base = baseOf(card);
                void controller.restoreUnit(u.unitId).then((r) => {
                  handleResult(card, r, "restore", base);
                  if (r.kind === "saved") {
                    showNotice(card, null);
                    settleFocus(card, card.editor?.title ?? null);
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
          card.body.appendChild(renderResources(card));
          const actions = el("div", "shell-units-actions");
          if (u.status === "active") {
            const add = button("Add resources");
            add.setAttribute("data-action", "add-resources");
            add.setAttribute("data-testid", `units-resources-add-${u.unitId}`);
            add.setAttribute("aria-label", `Add resources to ${u.title}`);
            add.setAttribute("aria-expanded", card.picker !== null ? "true" : "false");
            add.disabled = retiredCount(u) > 0;
            add.setAttribute("data-busy-gate", "");
            add.addEventListener("click", () => openPicker(card));
            actions.appendChild(add);
            const edit = button("Edit");
            edit.setAttribute("data-action", "edit");
            edit.setAttribute("data-testid", `units-edit-${u.unitId}`);
            edit.setAttribute("aria-label", `Edit ${u.title}`);
            edit.setAttribute("data-busy-gate", "");
            edit.addEventListener("click", () => openEditor(card));
            actions.appendChild(edit);
            const archive = button("Archive", "danger");
            archive.setAttribute("data-testid", `units-archive-${u.unitId}`);
            archive.setAttribute("aria-label", `Archive ${u.title}`);
            archive.setAttribute("data-busy-gate", "");
            archive.addEventListener("click", () => {
              const base = baseOf(card);
              void controller.archiveUnit(u.unitId).then((r) => {
                handleResult(card, r, "archive", base);
                if (r.kind === "saved") settleFocus(card, q(card, `units-restore-${u.unitId}`));
              });
            });
            actions.appendChild(archive);
          } else {
            const restore = button("Restore");
            restore.setAttribute("data-testid", `units-restore-${u.unitId}`);
            restore.setAttribute("aria-label", `Restore ${u.title}`);
            restore.setAttribute("data-busy-gate", "");
            restore.addEventListener("click", () => {
              const base = baseOf(card);
              void controller.restoreUnit(u.unitId).then((r) => {
                handleResult(card, r, "restore", base);
                if (r.kind === "saved") settleFocus(card, q(card, `units-archive-${u.unitId}`));
              });
            });
            actions.appendChild(restore);
          }
          card.body.appendChild(actions);
        },
        (tid) => {
          const swap = counterpartOf(tid);
          return (swap !== null ? q(card, swap) : null) ?? (card.li.isConnected ? cardAction(card) : heading);
        },
      );
      card.rendered = {
        unit: u,
        gone: card.gone,
        editor: card.editor,
        picker: card.picker,
        confirmRetired: card.confirmRetired,
        where,
      };
    }
    if (card.picker !== null) renderPickerOptions(card);
    applyBusy(card);
    if (refocus) {
      focusFirst(retiredButtonOf(card), addButtonOf(card), cardAction(card), heading);
    }
  };

  const q = (card: CardView, testid: string): HTMLElement | null =>
    card.li.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

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
    return {
      li, unit, gone: false, editor: null, picker: null, confirmRetired: null, noticeText: null, notice, body,
      rendered: null, pickerKey: null,
    };
  };

  let listMessage: string | null = null;
  const updateListMessage = (meaning: string, build: () => void): void => {
    if (meaning === listMessage) return;
    listMessage = meaning;
    listState.textContent = "";
    build();
  };
  const renderList = (s: TeacherUnitsViewState): void => {
    if (s.list.kind !== "ready") {
      for (const card of cards.values()) {
        const st = controller.getUnitState(card.unit.unitId);
        const latest = st.kind === "active" || st.kind === "archived" ? st.unit : null;
        const gone = latest === null;
        if (latest !== null) card.unit = latest;
        card.gone = gone;
        renderCardBody(card);
      }
    }
    if (s.list.kind === "loading") {
      updateListMessage("Loading units...", () => listState.appendChild(el("p", "shell-status", "Loading units...")));
      return;
    }
    if (s.list.kind === "error") {
      const message = readFailure(s.list.error, "list");
      updateListMessage(message, () => {
        const box = el("div", "shell-units-error");
        box.setAttribute("role", "alert");
        box.appendChild(el("p", "", message));
        const retry = button("Try again");
        retry.setAttribute("data-testid", "units-retry");
        retry.addEventListener("click", () => void controller.refresh());
        box.appendChild(retry);
        listState.appendChild(box);
      });
      return;
    }
    const units = s.list.units;
    const ids = new Set(units.map((u) => u.unitId));
    // Cards whose unit left the list are removed, unless an editor is open:
    // those stay pinned (with the latest known server state) so unsaved
    // edits are never discarded by a refresh, an archive, or a grade change.
    const pinned: CardView[] = [];
    let departed: { readonly unitId: string; readonly index: number } | null = null;
    for (const [id, c] of cards) {
      if (ids.has(id)) continue;
      if (c.editor !== null) {
        const st = controller.getUnitState(id);
        const latest = st.kind === "active" || st.kind === "archived" ? st.unit : null;
        c.gone = latest === null;
        if (latest !== null) c.unit = latest;
        renderCardBody(c);
        pinned.push(c);
      } else {
        if (departed === null && c.li.contains(doc.activeElement)) {
          departed = { unitId: id, index: Array.prototype.indexOf.call(list.children, c.li) };
        }
        keepNotice(c);
        c.li.remove();
        cards.delete(id);
      }
    }
    const empty = units.length === 0 && pinned.length === 0
      ? s.showArchived ? `You don't have any ${gradeLabel(s.grade)} units yet.`
        : `You don't have any active ${gradeLabel(s.grade)} units. Create one above.`
      : "";
    updateListMessage(empty, () => {
      if (empty !== "") listState.appendChild(el("p", "shell-units-empty", empty));
    });
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
    if (departed !== null) departFocus(departed.unitId, departed.index);
  };

  let wasConnected = false;
  // Focus that a render took away (its control was disabled, hidden, moved,
  // or removed) is put back: on the same control when it is still usable,
  // else on its card's main action, else the heading. Focus that a render
  // deliberately moved, or that is outside the panel, is left alone.
  const rescueFocus = (before: HTMLElement | null): void => {
    if (before === null) return;
    const a = doc.activeElement;
    if (a !== null && a !== doc.body && a !== before) return;
    if (canFocus(before)) {
      if (a !== before) focus(before);
      return;
    }
    const li = before.isConnected ? before.closest<HTMLElement>("li[data-unit-id]") : null;
    const card = li !== null ? cards.get(li.getAttribute("data-unit-id") ?? "") : undefined;
    focusFirst(card !== undefined ? cardAction(card) : null, heading);
  };
  const render = (): void => {
    if (disposed) return;
    // The Curriculum outlet was torn down (surface switch, sign-out,
    // account change): stop rendering and release the controller.
    if (root.isConnected) wasConnected = true;
    else if (wasConnected) {
      dispose();
      return;
    }
    const active = doc.activeElement;
    const before = active instanceof HTMLElement && active !== heading && root.contains(active) ? active : null;
    const s = controller.getState();
    for (const [g, b] of gradeButtons) {
      const active = g === s.grade;
      b.setAttribute("aria-pressed", active ? "true" : "false");
      b.classList.toggle("shell-filter-pill-active", active);
    }
    archivedBox.checked = s.showArchived;
    setAriaDisabled(checkChanges, checking || s.list.kind === "loading");
    renderCreate(s);
    renderList(s);
    refreshNotices();
    rescueFocus(before);
  };

  checkChanges.addEventListener("click", () => {
    if (isInert(checkChanges)) return;
    checking = true;
    const clearPending = announcePending("Checking for changes...");
    render();
    void controller.refresh().then(() => {
      if (disposed) return;
      checking = false;
      clearPending();
      // Superseded (a grade or archived-view change started a newer read) or
      // the account changed: that read reports for itself. A failure shows
      // in the list's own alert.
      if (controller.getState().list.kind === "ready") announce("Your units were checked for changes.");
      render();
    });
  });

  // Re-derives the current-state wording of every retained notice (card
  // notices and outcome entries) after each state or view change. Only the
  // contextual wording changes; identity, order, and the historical outcome
  // stay. A notice is rewritten only when its text actually changes, so
  // live regions are not re-announced needlessly. Accepted evidence is
  // reconciled even when the display list is loading or failed.
  const refreshNotices = (): void => {
    for (const card of cards.values()) {
      if (card.noticeText === null || card.notice.hidden) continue;
      const next = wordNotice(card.noticeText, card.unit.unitId);
      if (card.notice.textContent !== next) card.notice.textContent = next;
    }
    if (statusNotice !== null) {
      if (status.textContent !== statusNotice.shown) statusNotice = null;
      else {
        const next = wordNotice(statusNotice.text, statusNotice.unitId);
        if (next !== statusNotice.shown) {
          status.textContent = next;
          statusNotice.shown = next;
        }
      }
    }
    for (const e of entries.values()) {
      const next = entryText(e);
      if (e.message.textContent !== next) e.message.textContent = next;
      const label = `Dismiss notice about ${controller.getKnownUnit(e.unitId)?.title ?? e.fallbackTitle}`;
      if (e.dismiss.getAttribute("aria-label") !== label) e.dismiss.setAttribute("aria-label", label);
    }
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
