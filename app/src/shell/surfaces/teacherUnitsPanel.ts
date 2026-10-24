import { requireTeacherUnitsAvailable, teacherUnitsAvailable } from "../../teacherUnits/releaseAvailability";
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
  type TeacherUnitsSurfaceSeam,
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
import { isTeacherUnitsAvailabilityCode, type TeacherUnitError } from "../../teacherUnits/errors";
import type { UnresolvedCreateReason } from "../../teacherUnits/saveCoordination";
import type {
  CapacityReason,
  PendingMutationEntry,
  PendingMutationResolution,
} from "../../teacherUnits/pendingMutations";
import type { PendingUnitMutationRecord } from "../../teacherUnits/mutationReconciliation";
import { moveIndex } from "../../teacherUnits/unitOrderMath";
import { registerOpenModal } from "../openModals";
import { TEACHER_UNIT_COLORS, TEACHER_UNIT_COLOR_LABELS, unitColorKey } from "../../teacherUnits/unitColor";
import { buildUnitColorPicker } from "./unitColorPicker";
import { buildUnitsMenu } from "./unitsMenu";
import {
  buildLessonPreviewLink,
  buildResourceCard,
  buildResourceOpenLink,
  setResourceCardStatus,
} from "./resourceCard";

// U2.2 - My Units panel (docs/platform/TEACHER_UNITS.md §9.4). Since Teacher
// Units UX Milestone 1 it is the body of the top-level My Units workspace
// surface (myUnits.ts) rather than a Curriculum tab. DOM only: no Firebase,
// no browser storage. Everything it shows comes from the injected
// controller, which holds authoritative server state and the durable create
// attempts.
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
  newUnitIntentRequired: "Choose Create Unit first.",
});

const SVG_NS = "http://www.w3.org/2000/svg";

// The My Units surface is shown only when the shell holds a Teacher Units
// seam AND this release's availability boundary is open. A closed release
// (production today) has neither, so no My Units navigation item renders.
export function teacherUnitsSurfaceEnabled(seam: unknown): boolean {
  return seam !== null && seam !== undefined && teacherUnitsAvailable();
}

export type TeacherUnitsPanelOptions = {
  // Units start expanded instead of collapsed (title and resource count).
  readonly unitsInitiallyExpanded?: boolean;
  // The teacher left the archived view from inside the panel.
  readonly onArchivedViewExit?: () => void;
  // Milestone 2A ("View unit" after Add to Unit): this unit opens when its
  // card first appears, and takes focus if focus is still on the page's
  // entry point (the heading) or lost.
  readonly focusUnitId?: string | null;
  // Whether a unit's card starts open (the host's saved per-teacher
  // preference). `onExpandedChange` reports each open or close so the host
  // can save it.
  readonly isUnitInitiallyExpanded?: (unitId: string) => boolean;
  readonly onExpandedChange?: (unitId: string, expanded: boolean) => void;
  // Lesson rows mirror Curriculum's Assign / Results control, driven by the
  // shared Curriculum assignment state. Absent: lesson rows show Preview only.
  readonly lessonActions?: UnitLessonActions | null;
  // The Unit Results pill in each unit's header. Absent: no pill. The
  // panel resolves the unit's CURRENT resources (unit order) for the host.
  readonly onUnitResults?:
    | ((unit: TeacherUnit, resources: ReadonlyArray<UnitResultsResource>, trigger: HTMLElement) => void)
    | null;
};

// One of a unit's resources as Unit Results needs it: an available
// resource's id, type and title, or a resource that is no longer available.
export type UnitResultsResource =
  | { readonly status: "available"; readonly id: string; readonly type: string; readonly title: string }
  | { readonly status: "unavailable" };

const UNIT_COLOR_PALETTE = Object.freeze({ colors: TEACHER_UNIT_COLORS, labels: TEACHER_UNIT_COLOR_LABELS });

// The host's Curriculum lesson actions for a unit's lesson rows. The panel
// only places the control; its label, state, and workflow (the existing
// assignment dialog, or the lesson's existing Results page) are the host's.
export type UnitLessonActions = {
  // Whether this lesson takes the Assign / Results control at all.
  readonly supports: (slug: string) => boolean;
  // Applies the shared Curriculum Assign / Results state to the control.
  readonly apply: (control: HTMLButtonElement, slug: string) => void;
  readonly activate: (control: HTMLButtonElement, slug: string, unit: TeacherUnit) => void;
  // Called after a confirmed assignment change; controls are re-applied.
  readonly subscribe: (listener: () => void) => () => void;
};

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
  // Milestone 1: compact container. Collapsed shows the title and resource
  // count; expanded shows the description, resources, and unit actions.
  expanded: boolean;
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
  // The notice's Load current units action, shown only while its wording
  // names that step (see `readActionFor`).
  readonly noticeRead: HTMLButtonElement;
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
  options: TeacherUnitsPanelOptions = {},
): { readonly dispose: () => void } {
  requireTeacherUnitsAvailable();
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

  // The page headline of the My Units surface.
  const heading = el("h2", "shell-welcome shell-units-heading", "My Units");
  heading.id = "units-heading";
  heading.tabIndex = -1;
  root.appendChild(heading);

  // Grade selector and Create Unit. Show archived units
  // moved to Settings > Units (Milestone 1); the archived view is entered
  // from there and left with the banner below.
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
  // Milestone 1: one compact control opens the create form on request. The
  // selected grade decides the new unit's grade; the label never names it.
  const createOpen = button("", "primary");
  createOpen.classList.add("shell-units-create-open");
  createOpen.setAttribute("data-testid", "units-create-open");
  const plus = el("span", "shell-units-create-plus", "+");
  plus.setAttribute("aria-hidden", "true");
  createOpen.appendChild(plus);
  createOpen.appendChild(doc.createTextNode(" Create Unit"));
  createOpen.setAttribute("aria-expanded", "false");
  toolbar.appendChild(createOpen);
  // Ordinary freshness is automatic: every My Units visit creates a
  // controller whose first act is one authoritative list read, and
  // returning to this browser tab reads again (see `onVisibility`). The
  // toolbar has no manual read. A notice whose next step needs a list read
  // carries its own Load current units action (`readActionFor`), the same
  // controller `refresh`: it accepts only evidence newer than what is held,
  // never reloads the page, and never replays an unconfirmed change.

  // The archived view (entered from Settings > Units) lists archived units
  // with the active ones, each archived unit with its Restore control.
  const archivedView = el("div", "shell-units-archived-view");
  archivedView.setAttribute("data-testid", "units-archived-view");
  archivedView.setAttribute("role", "region");
  archivedView.setAttribute("aria-label", "Archived units");
  archivedView.hidden = true;
  const archivedViewText = el("p", "shell-units-archived-view-text");
  archivedView.appendChild(archivedViewText);
  const archivedExit = button("Show active units only");
  archivedExit.setAttribute("data-testid", "units-archived-exit");
  archivedExit.addEventListener("click", () => {
    controller.setShowArchived(false);
    options.onArchivedViewExit?.();
    focus(createOpen);
  });
  archivedView.appendChild(archivedExit);
  root.appendChild(archivedView);
  let checking = false;
  // List reads that completed (loading, then ready) during this panel.
  let listReadsDone = 0;
  let lastListKind: string | null = null;
  // The list read a Load current units action started, and whether any other
  // list read began after it. Success is announced only when that read
  // itself produced the list now shown.
  let checkRead: { readonly started: unknown; superseded: boolean } | null = null;

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
  // Contextual recovery: a notice whose current wording directs the teacher
  // to load the current units carries this action, and only that notice.
  // It is one list read (`refresh`, the same ordering, revision and account
  // guards as the automatic reads). It never confirms or undoes an earlier
  // change and never resends one; uncertain notices keep saying so.
  const READ_ACTION = "Load current units";
  const readActions = new Set<HTMLButtonElement>();
  const readActionFor = (testid: string): HTMLButtonElement => {
    const b = button(READ_ACTION);
    b.classList.add("shell-units-read-action");
    b.setAttribute("data-testid", testid);
    b.hidden = true;
    b.addEventListener("click", () => startRead(b));
    readActions.add(b);
    return b;
  };
  // Shows the action only while `text` names it. A focused action that
  // hides hands focus to `fallback` (else the render's focus rescue).
  const showReadAction = (b: HTMLButtonElement, text: string, fallback: HTMLElement | null): void => {
    const hide = !text.includes(READ_ACTION);
    if (b.hidden === hide) return;
    const had = doc.activeElement === b;
    b.hidden = hide;
    if (hide && had) focus(fallback);
  };
  const statusRead = readActionFor("units-status-load");
  root.appendChild(statusRead);
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
  // A3-4 S2 Unconfirmed changes: every pending non-create request of this
  // teacher and school, from the controller (which reads the seam-owned
  // registry, so the list survives leaving and reopening My Units), except
  // this panel's own requests still waiting for their response (their card
  // already shows them as in progress). Each entry states what was asked
  // and what the unit looks like now; it never says whether the request was
  // saved. Requests an earlier panel sent that are still waiting are listed
  // separately, as waiting, never as unconfirmed. Controls only read (Check
  // current state) or acknowledge (Dismiss); nothing here resends a request.
  const pendingBox = el("div", "shell-units-recovery shell-units-pending");
  pendingBox.setAttribute("data-testid", "units-pending");
  pendingBox.setAttribute("role", "region");
  pendingBox.setAttribute("aria-label", "Unconfirmed changes");
  pendingBox.hidden = true;
  root.appendChild(pendingBox);
  // The list is rebuilt; the live status line is not, so a screen reader
  // announces each update written to it (P2-5).
  const pendingBody = el("div");
  pendingBox.appendChild(pendingBody);
  const pendingStatus = el("p", "shell-units-recovery-note");
  pendingStatus.setAttribute("role", "status");
  pendingStatus.setAttribute("aria-live", "polite");
  pendingStatus.setAttribute("data-testid", "units-pending-status");
  pendingBox.appendChild(pendingStatus);
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
    readonly read: HTMLButtonElement;
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
    const gone = entries.get(box);
    if (gone !== undefined) readActions.delete(gone.read);
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
    // Dismiss stays the entry's first control; the read follows it.
    const read = readActionFor(`units-outcome-load-${id}`);
    box.appendChild(read);
    const entry: OutcomeEntry = { unitId, fallbackTitle, text, box, message, read, dismiss };
    entries.set(box, entry);
    message.textContent = entryText(entry);
    showReadAction(read, message.textContent, dismiss);
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
    showReadAction(statusRead, msg, heading);
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
  createForm.id = uid("create-form");
  createForm.setAttribute("data-testid", "units-create-form");
  createForm.noValidate = true;
  createForm.hidden = true;
  createSection.appendChild(createForm);
  createOpen.setAttribute("aria-controls", createForm.id);
  const createHeading = el("h4", "shell-units-subheading", "New unit");
  createForm.appendChild(createHeading);

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
  const createColor = buildUnitColorPicker(doc, "units-create-color", null, UNIT_COLOR_PALETTE);
  createForm.appendChild(createColor.fieldset);
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
  const createCancel = button("Cancel");
  createCancel.setAttribute("data-testid", "units-create-cancel");
  createActions.appendChild(createCancel);

  const resetCreateForm = (): void => {
    createTitle.value = "";
    createDescription.value = "";
    createColor.set(null);
    showCreateError(null);
  };
  // Whether the teacher asked for the create form. It closes after a
  // confirmed create; a pending, rejected, or blocked request keeps it open
  // so its state and message stay visible.
  let createFormOpen = false;
  const setCreateFormOpen = (open: boolean): void => {
    createFormOpen = open;
    createForm.hidden = !open;
    createOpen.setAttribute("aria-expanded", open ? "true" : "false");
  };
  // Explicit new-unit intent: after a confirmed create the controller needs
  // it before another create (U2.2); opening the form is that intent.
  const openCreateForm = (): void => {
    const kind = controller.getState().create.kind;
    if (kind === "created" && !controller.beginNewUnit()) return;
    if (kind === "created") resetCreateForm();
    setCreateFormOpen(true);
    focus(createTitle);
  };
  const closeCreateForm = (): void => {
    if (controller.getState().create.kind === "inFlight") return;
    setCreateFormOpen(false);
    focus(createOpen);
  };
  createOpen.addEventListener("click", () => {
    if (createFormOpen) closeCreateForm();
    else openCreateForm();
  });
  createCancel.addEventListener("click", closeCreateForm);
  createForm.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeCreateForm();
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
    // A submitted form is an open form.
    if (!createFormOpen) setCreateFormOpen(true);
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
    const color = createColor.value();
    void controller.submitCreate({
      grade: s.grade,
      title: createTitle.value.trim(),
      description: createDescription.value.trim(),
      ...(color !== null ? { color } : {}),
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
            setCreateFormOpen(true);
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
        el("p", "shell-units-recovery-note", "You can still create a new unit here with Create Unit."),
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
  // Units to open when their card first appears (a just-created unit), and
  // the created unit whose card takes focus once listed.
  // Milestone 2B: the reorder instructions every drag handle describes.
  const reorderHelpId = uid("reorder-help");
  const reorderHelp = el(
    "span",
    undefined,
    "To reorder, press Space or Enter to pick up, use the up and down arrow keys to move, then press Space or Enter to drop. Press Escape to cancel. With a mouse or touch, drag the handle.",
  );
  reorderHelp.id = reorderHelpId;
  reorderHelp.hidden = true;
  host.appendChild(reorderHelp);
  const expandOnArrival = new Set<string>();
  let createdFocus: string | null = null;
  let arrivalFocus: string | null = options.focusUnitId ?? null;
  if (arrivalFocus !== null) expandOnArrival.add(arrivalFocus);
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
    // A confirmed create closes the form (see the transitions below); every
    // other state leaves it as the teacher set it.
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
    createSubmit.textContent = create.kind === "inFlight" ? "Creating..." : "Create unit";
    const newHeading = `New ${gradeLabel(s.grade)} unit`;
    if (createHeading.textContent !== newHeading) createHeading.textContent = newHeading;
    setAriaDisabled(createCancel, pending);

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

    // A rejected request's message is in the form, so the form shows.
    if (create.kind === "rejected" && !createFormOpen) setCreateFormOpen(true);

    // Transitions: announce and move focus to the next meaningful control,
    // since the control that started the action may now be hidden.
    // Focus moves only while it is still the create's own: in the create
    // area, or lost. A teacher who moved elsewhere keeps their focus.
    const a = doc.activeElement;
    const ownsCreate = a === null || a === doc.body || createSection.contains(a) || a === createOpen;
    // Milestone 1: one brief success notification (the polite status line);
    // the form closes and the new unit opens, ready for resources.
    if (prevCreateKind !== create.kind && create.kind === "created") {
      setCreateFormOpen(false);
      expandOnArrival.add(create.unit.unitId);
    }
    if (prevCreateKind !== create.kind && !ownsCreate) {
      if (create.kind === "created") announce(`Created "${create.unit.title}" in ${gradeLabel(create.unit.grade)}.`);
      else if (prevCreateKind === "inFlight" && create.kind === "unresolved") announce(createUnresolved(create.reason));
    } else if (prevCreateKind !== create.kind) {
      if (create.kind === "created") {
        announce(`Created "${create.unit.title}" in ${gradeLabel(create.unit.grade)}.`);
        createdFocus = create.unit.unitId;
        focus(createOpen);
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
  // A card's main action: its unit management menu (Edit Unit, Add
  // Resources, Archive Unit, or Restore Unit live there), else its first
  // available button.
  const cardAction = (card: CardView): HTMLElement | null => {
    if (!card.li.isConnected) return null;
    const menu = card.body.querySelector<HTMLElement>("[data-action=unit-menu]");
    if (canFocus(menu)) return menu;
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
    if (focusEdit) focusFirst(card.li.querySelector<HTMLButtonElement>("[data-action=edit]"), cardAction(card));
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
    showReadAction(card.noticeRead, card.notice.textContent, null);
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
    showReadAction(card.noticeRead, "", null);
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
        announce(result.noop ? "No change was needed when this request was checked." : `${VERB[op]}: "${result.unit.title}".`);
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
            "This unit was archived, so LyfeLabz couldn't confirm whether your changes were saved.",
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
      case "needsCheck":
        showNotice(card, needsCheckNotice(card), "conflict");
        if (card.editor) settleFocus(card, card.editor.save);
        return;
      case "capacity":
        showNotice(card, capacityNotice(card, result.reason), "conflict");
        if (card.editor) settleFocus(card, card.editor.save);
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
    const color = buildUnitColorPicker(
      doc,
      `units-edit-color-${card.unit.unitId}`,
      card.unit.color,
      UNIT_COLOR_PALETTE,
    );
    form.appendChild(color.fieldset);
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
        .updateUnit(card.unit.unitId, {
          title: title.value,
          description: description.value,
          color: color.value(),
        })
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
        showReadAction(statusRead, "", heading);
      }
    };
  };

  const addButtonOf = (card: CardView): HTMLElement | null =>
    card.li.querySelector<HTMLElement>(`[data-testid="units-resources-add-${card.unit.unitId}"]`);

  // ---------- Membership confirmation evidence ----------
  //
  // A settled membership request is described from two facts only:
  // 1. what the response proves: `noop` means the unit already matched the
  //    request when the response was produced (never "saved"; under A3-3
  //    section 5.1 an earlier SDK attempt of the same request may have made
  //    that change, so never "nothing changed"); otherwise the server
  //    committed the write;
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
      return "This unit's current state hasn't been confirmed. Choose Load current units to see it.";
    }
    const card = cards.get(unitId);
    const editorOpen = card?.editor != null;
    if (st.unit.grade !== view.grade) {
      return `This is a ${gradeLabel(st.unit.grade)} unit, so it isn't in the ${gradeLabel(view.grade)} list.${editorOpen ? " Its editor is still open." : ""} Choose ${gradeLabel(st.unit.grade)} to see it in the list.`;
    }
    if (st.kind === "archived" && !view.showArchived) {
      return `This unit is archived, so it isn't in the list.${editorOpen ? " Its editor is still open." : ""} Choose View archived units in Settings > Units to see its resources in the list.`;
    }
    if (card?.li.isConnected && !card.gone && card.unit === st.unit) return null;
    if (view.list.kind === "loading") return "The unit list is loading. These details are from the latest version LyfeLabz has loaded.";
    if (view.list.kind === "error") return "The unit list couldn't be refreshed. These details are from the latest version LyfeLabz has loaded.";
    return isListed(unitId) ? null : "This unit isn't in your current list. Choose Load current units to see its resources.";
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
  // "Couldn't be loaded" holds only until a list read completes after the
  // notice: a read at the same revision is still current state (never proof
  // either way), so the notice then stops offering Load current units again.
  const uncertainUnread = (base: number): NoticeText => {
    const since = listReadsDone;
    return contextualNotice(UNCERTAIN_HISTORY, (ctx) =>
    (ctx.unit !== null && ctx.unit.revision > base) || ctx.absent || (ctx.active && listReadsDone > since)
      ? uncertainNext(ctx)
      : sentences(["The unit couldn't be loaded after that request.", ctx.where, ctx.archived ? "Restore it before making further changes." : ctx.active ? "Choose Load current units before trying again." : null]),
    );
  };
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
    const fact = !write ? "No change was needed when this request was checked."
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
        : !newer
          ? write
            ? "Your change was saved, but the latest loaded resources don't show it yet. Choose Load current units to see them."
            : "The latest loaded resources don't show this request's result yet. Choose Load current units to see them."
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
        ? "This unit changed since it was loaded here, so LyfeLabz couldn't confirm whether your change was saved."
        : `This unit changed since it was loaded here, so LyfeLabz couldn't confirm whether ${what === "add" ? "anything was added" : what === "move" ? "it was moved" : "it was removed"}.`;
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
        next = [ctx.where ?? "Choose Load current units, then try again."];
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
            ? "Choose Load current units to see its current state before trying again."
            : "Choose Load current units to see its current state.",
        ]);
      }
      const now = op === "edit"
        ? `The latest version LyfeLabz has loaded is named "${ctx.unit.title}".`
        : ctx.archived ? "It is archived now." : "It is active now.";
      return sentences([now, editing, ctx.where]);
    });
  // A3-4 S2 (D3, P2-1): the controller refused to send a change because an
  // earlier change to this unit is unconfirmed and no current state has been
  // loaded since. Definite: this request was not sent. Nothing is resent.
  const needsCheckNotice = (card: CardView): NoticeText =>
    contextualNotice("An earlier change to this unit wasn't confirmed, so LyfeLabz didn't send this one.", () =>
      sentences([
        card.editor !== null ? "Your edits are still here." : null,
        "Choose Check current state under Unconfirmed changes, or Load current units, to load the unit's current state. Then review it and try again.",
      ]),
    );
  // Bounded tracking (pendingMutations.ts): this request was not sent.
  // Fifth remediation P3: the guidance names only an action that can free
  // the bound that refused this change (pendingMutations.ts CapacityReason),
  // never a dismissal when nothing can be dismissed, never a read when reads
  // cannot help, and never a change made only to free room.
  const capacityNotice = (card: CardView, reason: CapacityReason): NoticeText =>
    contextualNotice(
      reason === "retained"
        ? "LyfeLabz has reached its limit for keeping track of earlier unconfirmed changes during this visit, so it didn't send this one."
        : "LyfeLabz is already keeping track of as many unconfirmed changes as it can, so it didn't send this one.",
      () => {
        const editing = card.editor !== null ? "Your edits are still here." : null;
        if (reason === "retained") {
          return sentences([
            editing,
            "Loading your current units or dismissing notices won't make room. Reloading the page starts a new visit and clears what LyfeLabz is keeping track of here, but it doesn't confirm or undo any earlier change, and it doesn't cancel changes already sent, which may still finish. Anything you haven't saved on this page will be lost, so copy it first.",
          ]);
        }
        if (reason === "blocking") {
          return sentences([
            editing,
            "Too many units have unconfirmed changes whose current state hasn't been loaded. Choose Load current units in each grade they're in (choose View archived units in Settings > Units to include archived units), then try again.",
          ]);
        }
        const dismissible = controller.getState().pending.some((e) => e.status === "uncertain");
        return sentences([
          editing,
          dismissible
            ? "Review the changes listed under Unconfirmed changes and dismiss the ones you've checked, then try again."
            : "LyfeLabz is still waiting for responses to earlier changes. Try again once they're listed under Unconfirmed changes or resolved.",
        ]);
      },
    );
  const failureNotice = (
    error: TeacherUnitError,
    lifecycle?: { readonly card: CardView; readonly op: LifecycleOp; readonly base: number },
  ): NoticeText => {
    if (lifecycle !== undefined && (error.category === "network" || error.category === "unexpected" || error.category === "unconfirmed")) {
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
      case "unconfirmed":
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
    if (isTeacherUnitsAvailabilityCode(error.code)) return `${history} because Teacher Units isn't available right now. Try again later.`;
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
    // A transaction refusal never proves this request wrote nothing (A3-3 5.1).
    const unconfirmed = action === "add" ? "anything was added" : action === "move" ? "it was moved" : "it was removed";
    switch (result.kind) {
      case "conflict":
        showNotice(card, conflictNotice(card, action, result.latest, base), "conflict");
        return;
      case "archived":
        showNotice(
          card,
          contextualNotice(`This unit was archived, so LyfeLabz couldn't confirm whether ${unconfirmed}.`, ctx =>
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
      case "needsCheck":
        showNotice(card, needsCheckNotice(card), "conflict");
        return;
      case "capacity":
        showNotice(card, capacityNotice(card, result.reason), "conflict");
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
    const h = picker.form.querySelector("h4");
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
    const h = el("h4", "shell-units-subheading", `Add resources to "${u.title}"`);
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
        // Remove from Unit sits in each row's menu, so focus lands on the
        // menu of the row now at that position.
        const menus = card.li.querySelectorAll<HTMLElement>("[data-action=resource-menu]");
        settleFocus(card, menus[Math.min(index, menus.length - 1)] ?? null, addButtonOf(card));
        return;
      }
      membershipNotice(card, result, "remove", base);
      const rowMenu = card.li.querySelector<HTMLElement>(
        `[data-testid="units-resource-menu-${card.unit.unitId}-${resourceId}"]`,
      );
      settleFocus(card, removeOf(), rowMenu, addButtonOf(card));
    });
  };

  // U2.4 ordering, Milestone 2B interaction: a six-dot drag handle at the
  // left of each row replaces Move up / Move down. A completed move is one
  // `moveResourceTo` request (the held list as a permutation, with its
  // revision); a move back to the same position sends nothing. The row
  // moves only when the server's response is accepted. Focus returns to the
  // same resource's handle.
  //
  // Pointer (mouse, pen, touch): press the handle and drag; an insertion
  // line shows where the resource will go; release to save. The handle has
  // `touch-action: none` and captures the pointer, so dragging it never
  // scrolls the page or activates Preview or Remove.
  //
  // Keyboard: Space or Enter on the handle picks the resource up; Up/Down
  // (Home/End) move it in a live preview; Space or Enter drops it; Escape,
  // Tab, or leaving the handle cancels. Every step is announced in the
  // panel's polite status region.
  const handleTestId = (unitId: string, resourceId: string): string =>
    `units-resource-handle-${unitId}-${resourceId}`;
  const handleOf = (card: CardView, resourceId: string): HTMLElement | null =>
    card.li.querySelector<HTMLElement>(`[data-testid="${handleTestId(card.unit.unitId, resourceId)}"]`);

  type ResourceDrag = {
    readonly card: CardView;
    readonly resourceId: string;
    readonly name: string;
    readonly handle: HTMLElement;
    readonly list: HTMLElement;
    readonly from: number;
    readonly count: number;
    readonly mode: "keyboard" | "pointer";
    to: number;
    pointerId: number | null;
    startY: number;
    moved: boolean;
  };
  let drag: ResourceDrag | null = null;

  const rowsOf = (list: HTMLElement): HTMLElement[] =>
    Array.from(list.querySelectorAll<HTMLElement>(":scope > li"));
  const clearDragPresentation = (d: ResourceDrag): void => {
    for (const li of rowsOf(d.list)) {
      li.style.order = "";
      li.classList.remove("shell-units-resource-dragging", "shell-units-drop-before", "shell-units-drop-after");
    }
    d.list.classList.remove("shell-units-resource-list-sorting");
    d.handle.removeAttribute("aria-pressed");
  };
  // Keyboard preview: the visual order follows the pending position (CSS
  // `order`, so the focused handle never leaves the document).
  const previewOrder = (d: ResourceDrag): void => {
    const rows = rowsOf(d.list);
    const ids = rows.map((li) => li.getAttribute("data-resource-id"));
    const next = moveIndex(ids, d.from, d.to);
    rows.forEach((li) => {
      li.style.order = String(next.indexOf(li.getAttribute("data-resource-id")));
    });
  };
  // Pointer feedback: a line before or after the row the resource will land
  // next to (rows stay in server order while dragging).
  const showInsertion = (d: ResourceDrag): void => {
    const others = rowsOf(d.list).filter((li) => li.getAttribute("data-resource-id") !== d.resourceId);
    for (const li of others) li.classList.remove("shell-units-drop-before", "shell-units-drop-after");
    if (d.to === d.from) return;
    if (d.to === 0) others[0]?.classList.add("shell-units-drop-before");
    else others[d.to - 1]?.classList.add("shell-units-drop-after");
  };
  const positionText = (d: ResourceDrag): string => `position ${d.to + 1} of ${d.count}`;

  const endDrag = (announcement: string | null): void => {
    const d = drag;
    if (d === null) return;
    drag = null;
    clearDragPresentation(d);
    if (d.pointerId !== null) {
      try {
        d.handle.releasePointerCapture(d.pointerId);
      } catch {
        // ignored
      }
    }
    if (announcement !== null) announce(announcement);
  };
  // A card body rebuilt mid-move (a newer record arrived) ends the move.
  const endDetachedDrag = (): void => {
    if (drag !== null && !drag.handle.isConnected) {
      endDrag(`Move cancelled. "${drag.name}" wasn't moved because this unit's resources changed.`);
    }
  };

  const commitDrag = (d: ResourceDrag): void => {
    const { card, resourceId, name } = d;
    const unitTitle = card.unit.title;
    const base = baseOf(card);
    const to = d.to;
    endDrag(null);
    const clearPending = announcePending(`Moving "${name}" to position ${to + 1} of ${d.count} in "${unitTitle}"...`);
    void controller.moveResourceTo(card.unit.unitId, resourceId, to).then((result) => {
      if (disposed) return;
      clearPending();
      if (result.kind === "stale" || result.kind === "busy") return;
      if (result.kind === "saved") {
        showOutcome(card, moveOutcome(result, resourceId, name));
      } else {
        membershipNotice(card, result, "move", base);
      }
      settleFocus(card, handleOf(card, resourceId));
    });
  };

  const beginDrag = (
    card: CardView,
    handle: HTMLElement,
    resourceId: string,
    name: string,
    mode: ResourceDrag["mode"],
  ): ResourceDrag | null => {
    if (drag !== null || isInert(handle)) return null;
    const list = handle.closest<HTMLElement>("ol");
    if (list === null) return null;
    const ids = rowsOf(list).map((li) => li.getAttribute("data-resource-id"));
    const from = ids.indexOf(resourceId);
    if (from === -1) return null;
    drag = { card, resourceId, name, handle, list, from, count: ids.length, mode, to: from, pointerId: null, startY: 0, moved: false };
    return drag;
  };

  const onHandleKey = (card: CardView, handle: HTMLElement, resourceId: string, name: string, ev: KeyboardEvent): void => {
    const d = drag !== null && drag.handle === handle && drag.mode === "keyboard" ? drag : null;
    const pick = ev.key === " " || ev.key === "Enter";
    if (d === null) {
      if (!pick || ev.repeat) return;
      ev.preventDefault();
      const started = beginDrag(card, handle, resourceId, name, "keyboard");
      if (started === null) return;
      handle.setAttribute("aria-pressed", "true");
      started.list.classList.add("shell-units-resource-list-sorting");
      handle.closest("li")?.classList.add("shell-units-resource-dragging");
      announce(
        `Picked up "${name}", ${positionText(started)}. Use the up and down arrow keys to move it, Space to drop it, or Escape to cancel.`,
      );
      return;
    }
    if (pick) {
      ev.preventDefault();
      if (ev.repeat) return;
      if (d.to === d.from) {
        endDrag(`"${name}" was dropped in its original position. Nothing was changed.`);
        return;
      }
      commitDrag(d);
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      endDrag(`Move cancelled. "${name}" is back at position ${d.from + 1} of ${d.count}.`);
      return;
    }
    if (ev.key === "Tab") {
      endDrag(`Move cancelled. "${name}" is back at position ${d.from + 1} of ${d.count}.`);
      return;
    }
    const next =
      ev.key === "ArrowUp" ? d.to - 1
        : ev.key === "ArrowDown" ? d.to + 1
          : ev.key === "Home" ? 0
            : ev.key === "End" ? d.count - 1
              : null;
    if (next === null) return;
    ev.preventDefault();
    const to = Math.max(0, Math.min(d.count - 1, next));
    if (to === d.to) {
      announce(`"${name}" is already at ${to === 0 ? "the top" : "the bottom"}, ${positionText(d)}.`);
      return;
    }
    d.to = to;
    previewOrder(d);
    announce(`"${name}", ${positionText(d)}.`);
  };

  const DRAG_THRESHOLD_PX = 4;
  const EDGE_SCROLL_PX = 48;
  const scrollerOf = (el: HTMLElement): HTMLElement | null => {
    for (let n = el.parentElement; n !== null; n = n.parentElement) {
      const oy = doc.defaultView?.getComputedStyle(n).overflowY ?? "";
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return (doc.scrollingElement as HTMLElement | null) ?? null;
  };
  const attachPointerDrag = (card: CardView, handle: HTMLElement, resourceId: string, name: string): void => {
    handle.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button !== 0 || !ev.isPrimary) return;
      const d = beginDrag(card, handle, resourceId, name, "pointer");
      if (d === null) return;
      // No text selection, no click on the row, no page scroll from this press.
      ev.preventDefault();
      d.pointerId = ev.pointerId;
      d.startY = ev.clientY;
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch {
        // ignored
      }
    });
    handle.addEventListener("pointermove", (ev: PointerEvent) => {
      const d = drag;
      if (d === null || d.handle !== handle || d.pointerId !== ev.pointerId) return;
      if (!d.moved) {
        if (Math.abs(ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
        d.moved = true;
        d.list.classList.add("shell-units-resource-list-sorting");
        handle.closest("li")?.classList.add("shell-units-resource-dragging");
      }
      ev.preventDefault();
      const others = rowsOf(d.list).filter((li) => li.getAttribute("data-resource-id") !== resourceId);
      let before = 0;
      for (const li of others) {
        const r = li.getBoundingClientRect();
        if (ev.clientY > r.top + r.height / 2) before += 1;
      }
      d.to = before;
      showInsertion(d);
      // Near the viewport edge, scroll so long units stay reachable.
      const view = doc.defaultView;
      const scroller = scrollerOf(d.list);
      if (view !== null && scroller !== null) {
        if (ev.clientY < EDGE_SCROLL_PX) scroller.scrollTop -= 12;
        else if (ev.clientY > view.innerHeight - EDGE_SCROLL_PX) scroller.scrollTop += 12;
      }
    });
    const finish = (ev: PointerEvent, cancelled: boolean): void => {
      const d = drag;
      if (d === null || d.handle !== handle || d.pointerId !== ev.pointerId) return;
      if (cancelled || !d.moved) {
        endDrag(cancelled && d.moved ? `Move cancelled. "${name}" wasn't moved.` : null);
        return;
      }
      if (d.to === d.from) {
        endDrag(`"${name}" was dropped in its original position. Nothing was changed.`);
        return;
      }
      commitDrag(d);
    };
    handle.addEventListener("pointerup", (ev: PointerEvent) => finish(ev, false));
    handle.addEventListener("pointercancel", (ev: PointerEvent) => finish(ev, true));
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
    // The list begins directly beneath the unit header: no visible
    // "Resources (N)" heading; the group is named for assistive technology.
    section.setAttribute("role", "group");
    section.setAttribute("aria-label", `Resources in ${u.title}`);
    const resolved = resolveUnitResources(u.resourceIds);
    const retired = retiredCount(u);
    if (resolved.length === 0) {
      section.appendChild(el("p", "shell-units-empty", "No resources in this unit yet."));
    } else {
      // Server order (unit.resourceIds); never re-sorted here.
      const ol = el("ol", "shell-units-resource-list");
      ol.setAttribute("data-testid", `units-resource-list-${u.unitId}`);
      resolved.forEach((entry, i) => {
        const li = el("li", "shell-units-resource");
        li.setAttribute("data-resource-id", entry.id);
        const name = entry.status === "available" ? entry.resource.title : "A resource that is no longer available";
        // Milestone 1: the same full-width resource card as Curriculum
        // (resourceCard.ts). Membership controls stay this panel's own.
        const row = entry.status === "available"
          ? buildResourceCard(doc, {
            className: "shell-units-resource-card",
            tag: "div",
            grade: entry.resource.grade,
            topic: entry.resource.topic,
            typeLabel: resourceTypeLabel(entry.resource),
            title: name,
            titleTag: "span",
            // Milestone 2B: the type follows the title, as in Curriculum.
            typePlacement: "title",
          })
          : buildResourceCard(doc, {
            className: "shell-units-resource-card",
            tag: "div",
            grade: null,
            topic: null,
            typeLabel: null,
            title: name,
            titleTag: "span",
          });
        li.appendChild(row.card);
        const cardActions = row.actions;
        if (entry.status === "available") {
          if (resourceEligibility(entry.resource) === "organizeOnly") setResourceCardStatus(row, "Not assignable");
          // Lessons mirror Curriculum: Assign (unassigned) or Results
          // (assigned, even with zero submissions) from the shared Curriculum
          // assignment state, then Preview. Other resources keep Open; no
          // unsupported Assign or Results control is created for them.
          const r = entry.resource;
          const lessonActions = options.lessonActions ?? null;
          if (
            lessonActions !== null &&
            r.type === "lesson" &&
            resourceEligibility(r) !== "organizeOnly" &&
            lessonActions.supports(r.id)
          ) {
            const primary = el("button", "shell-lesson-assign");
            primary.type = "button";
            primary.setAttribute("data-testid", `units-resource-assign-${u.unitId}-${r.id}`);
            primary.setAttribute("data-lesson-slug", r.id);
            lessonActions.apply(primary, r.id);
            primary.addEventListener("click", () => lessonActions.activate(primary, r.id, card.unit));
            cardActions.appendChild(primary);
          }
          // Preview for a lesson, Open for every other resource: the same
          // teacher-safe links Curriculum uses. Neither assigns anything.
          const view = r.type === "lesson"
            ? buildLessonPreviewLink(doc, { slug: r.id, title: name }, `units-resource-preview-${u.unitId}-${r.id}`)
            : buildResourceOpenLink(doc, r.openHref, `Open ${name} (opens in a new tab)`, `units-resource-open-${u.unitId}-${r.id}`);
          if (view !== null) cardActions.appendChild(view);
        }
        // U2.4 ordering (Milestone 2B drag handle): only while every resource
        // is placeable (the server refuses any list that still names a
        // retired id) and there is something to reorder. A pending handle
        // stays focusable (aria-disabled) and refuses to start a move.
        if (u.status === "active" && entry.status === "available" && retired === 0 && resolved.length > 1) {
          const handle = button("");
          handle.className = "shell-units-drag-handle";
          handle.setAttribute("data-action", "move-resource");
          handle.setAttribute("data-testid", handleTestId(u.unitId, entry.id));
          handle.setAttribute("aria-label", `Reorder ${name}, position ${i + 1} of ${resolved.length} in ${u.title}`);
          handle.setAttribute("aria-describedby", reorderHelpId);
          handle.setAttribute("data-busy-gate", "");
          handle.appendChild(el("span", "shell-units-drag-grip")).setAttribute("aria-hidden", "true");
          // A plain click (no drag, no key) does nothing.
          handle.addEventListener("click", (ev) => ev.preventDefault());
          handle.addEventListener("keydown", (ev) => onHandleKey(card, handle, entry.id, name, ev));
          handle.addEventListener("blur", () => {
            if (drag !== null && drag.handle === handle && drag.mode === "keyboard") {
              endDrag(`Move cancelled. "${name}" is back at position ${drag.from + 1} of ${drag.count}.`);
            }
          });
          attachPointerDrag(card, handle, entry.id, name);
          li.classList.add("shell-units-resource-sortable");
          li.insertBefore(handle, row.card);
        }
        // Retired rows are removed together (below); one at a time would be
        // refused while another retired id remains.
        // Remove from Unit: a quiet row-level menu, never a prominent pill.
        // It only ends this unit's membership; the resource itself and any
        // Classroom assignment of it are untouched.
        if (u.status === "active" && entry.status === "available") {
          const rowMenu = buildUnitsMenu(doc, {
            triggerLabel: `More actions for ${name}`,
            triggerTestId: `units-resource-menu-${u.unitId}-${entry.id}`,
            triggerAction: "resource-menu",
            variant: "row",
            items: [
              {
                label: "Remove from Unit",
                testid: `units-resource-remove-${u.unitId}-${entry.id}`,
                action: "remove-resource",
                busyGate: true,
                disabled: retired > 0,
                onSelect: () => removeResource(card, entry.id, name, i),
              },
            ],
          });
          cardActions.appendChild(rowMenu.root);
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
    // The teacher's unit color (neutral "none" for a unit without one).
    const colorKey = unitColorKey(u.color);
    if (card.li.getAttribute("data-unit-color") !== colorKey) card.li.setAttribute("data-unit-color", colorKey);
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
          // One compact header row. Left: the unit's color and title (the
          // title is always text, so color is never the only identity cue).
          // Right: Unit Results, the expand/collapse chevron, and the unit
          // management menu, as three separate controls. No resource count.
          const titleRow = el("div", "shell-units-card-title-row");
          const titleHeading = el("h3", "shell-units-card-heading");
          const detailsId = uid("unit-details");
          const swatch = el("span", "shell-units-card-swatch");
          swatch.setAttribute("aria-hidden", "true");
          const titleText = el("span", "shell-units-card-title", u.title);
          titleText.setAttribute("data-testid", `units-title-${u.unitId}`);
          titleHeading.append(swatch, titleText);
          titleRow.appendChild(titleHeading);
          if (u.status === "archived") titleRow.appendChild(el("span", "shell-units-badge", "Archived"));

          const controls = el("div", "shell-units-card-controls");
          const onUnitResults = options.onUnitResults ?? null;
          if (onUnitResults !== null) {
            const results = el("button", "shell-units-results-pill", "Unit Results");
            results.type = "button";
            results.setAttribute("data-testid", `units-results-${u.unitId}`);
            results.setAttribute("aria-label", `Unit Results for ${u.title}`);
            results.addEventListener("click", () => {
              const resources: UnitResultsResource[] = resolveUnitResources(card.unit.resourceIds).map((entry) =>
                entry.status === "available"
                  ? { status: "available", id: entry.resource.id, type: entry.resource.type, title: entry.resource.title }
                  : { status: "unavailable" },
              );
              onUnitResults(card.unit, resources, results);
            });
            controls.appendChild(results);
          }
          const toggle = el("button", "shell-units-card-toggle");
          toggle.type = "button";
          toggle.setAttribute("data-testid", `units-toggle-${u.unitId}`);
          toggle.setAttribute("aria-controls", detailsId);
          toggle.setAttribute("aria-expanded", card.expanded ? "true" : "false");
          toggle.setAttribute("aria-label", `Show resources in ${u.title}`);
          // A stroked chevron that points up when open and down when closed
          // (CSS turns it from `aria-expanded`).
          const chevron = doc.createElementNS(SVG_NS, "svg");
          chevron.setAttribute("class", "shell-units-card-chevron");
          chevron.setAttribute("viewBox", "0 0 24 24");
          chevron.setAttribute("aria-hidden", "true");
          chevron.setAttribute("focusable", "false");
          const chevronPath = doc.createElementNS(SVG_NS, "path");
          chevronPath.setAttribute("d", "M6 9l6 6 6-6");
          chevron.appendChild(chevronPath);
          toggle.appendChild(chevron);
          controls.appendChild(toggle);

          const unitItems =
            u.status === "active"
              ? [
                  {
                    label: "Edit Unit",
                    testid: `units-edit-${u.unitId}`,
                    action: "edit",
                    busyGate: true,
                    onSelect: () => openEditor(card),
                  },
                  {
                    label: "Add Resources",
                    testid: `units-resources-add-${u.unitId}`,
                    action: "add-resources",
                    busyGate: true,
                    disabled: retiredCount(u) > 0,
                    onSelect: () => {
                      if (!card.expanded) toggle.click();
                      openPicker(card);
                    },
                  },
                  {
                    // Archive keeps its existing semantics: reversible from
                    // Restore Unit, never a deletion; no confirmation step,
                    // exactly as before.
                    label: "Archive Unit",
                    testid: `units-archive-${u.unitId}`,
                    danger: true,
                    busyGate: true,
                    onSelect: () => {
                      const base = baseOf(card);
                      void controller.archiveUnit(u.unitId).then((r) => {
                        handleResult(card, r, "archive", base);
                        if (r.kind === "saved") settleFocus(card, q(card, `units-restore-${u.unitId}`));
                      });
                    },
                  },
                ]
              : [
                  {
                    label: "Restore Unit",
                    testid: `units-restore-${u.unitId}`,
                    busyGate: true,
                    onSelect: () => {
                      const base = baseOf(card);
                      void controller.restoreUnit(u.unitId).then((r) => {
                        handleResult(card, r, "restore", base);
                        if (r.kind === "saved") settleFocus(card, q(card, `units-archive-${u.unitId}`));
                      });
                    },
                  },
                ];
          const unitMenu = buildUnitsMenu(doc, {
            triggerLabel: `Manage ${u.title}`,
            triggerTestId: `units-menu-${u.unitId}`,
            triggerAction: "unit-menu",
            variant: "unit",
            items: unitItems,
          });
          controls.appendChild(unitMenu.root);
          titleRow.appendChild(controls);
          card.body.appendChild(titleRow);

          const details = el("div", "shell-units-card-details");
          details.id = detailsId;
          details.setAttribute("data-testid", `units-details-${u.unitId}`);
          details.hidden = !card.expanded;
          card.body.appendChild(details);
          toggle.addEventListener("click", () => {
            card.expanded = !card.expanded;
            details.hidden = !card.expanded;
            toggle.setAttribute("aria-expanded", card.expanded ? "true" : "false");
            options.onExpandedChange?.(u.unitId, card.expanded);
          });
          // Mouse/touch convenience: the title also opens and closes the
          // unit. The chevron stays the single keyboard control for it.
          titleText.addEventListener("click", () => toggle.click());
          if (u.description.length > 0) {
            details.appendChild(el("p", "shell-units-card-description", u.description));
          }
          details.appendChild(renderResources(card));
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
    endDetachedDrag();
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
    const noticeRead = readActionFor(`units-notice-load-${unit.unitId}`);
    li.appendChild(noticeRead);
    const saved = options.isUnitInitiallyExpanded?.(unit.unitId) === true;
    const arriving = expandOnArrival.delete(unit.unitId);
    // A unit opened on arrival ("View unit") stays open next time too.
    if (arriving && !saved) options.onExpandedChange?.(unit.unitId, true);
    const expanded = options.unitsInitiallyExpanded === true || arriving || saved;
    return {
      li, unit, expanded, gone: false, editor: null, picker: null, confirmRetired: null, noticeText: null, notice, noticeRead, body,
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
      ? s.showArchived ? `No ${gradeLabel(s.grade)} units yet.` : `No active ${gradeLabel(s.grade)} units yet.`
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
    // A just-created unit's card takes focus from Create Unit once listed.
    if (createdFocus !== null) {
      const created = cards.get(createdFocus);
      if (created !== undefined) {
        createdFocus = null;
        expandOnArrival.delete(created.unit.unitId);
        if (!created.expanded) {
          created.expanded = true;
          created.rendered = null;
          renderCardBody(created);
        }
        if (doc.activeElement === createOpen) focus(q(created, `units-toggle-${created.unit.unitId}`));
      }
    }
    if (arrivalFocus !== null) {
      const target = cards.get(arrivalFocus);
      if (target !== undefined) {
        const a = doc.activeElement;
        if (a === null || a === doc.body || a === heading) focus(q(target, `units-toggle-${target.unit.unitId}`));
      }
      // One chance: the first ready list either shows the unit or it is not
      // in this view (archived, or gone), and the entry focus stays.
      if (target !== undefined || s.list.kind === "ready") {
        if (target === undefined) expandOnArrival.delete(arrivalFocus);
        arrivalFocus = null;
      }
    }
  };

  // ---------- Unconfirmed changes (A3-4 S2) ----------
  //
  // Present-state wording only (approved decision D2): a finding describes
  // the unit as LyfeLabz last read it after the request, never whether the
  // request committed. A matching state may come from another change.
  const askedFor = (r: PendingUnitMutationRecord): string => {
    const name = `"${r.titleAtRequest}"`;
    switch (r.intent.op) {
      case "update":
        if (r.intent.title !== undefined && r.intent.title !== r.titleAtRequest) {
          return r.intent.description !== undefined
            ? `You asked to rename ${name} to "${r.intent.title}" and change its description.`
            : `You asked to rename ${name} to "${r.intent.title}".`;
        }
        return `You asked to change the description of ${name}.`;
      case "archive":
        return `You asked to archive ${name}.`;
      case "restore":
        return `You asked to restore ${name}.`;
      case "setResources":
        switch (r.intent.purpose) {
          case "add":
            return `You asked to add resources to ${name}.`;
          case "remove":
            return `You asked to remove a resource from ${name}.`;
          case "move":
            return `You asked to move a resource in ${name}.`;
          case "repair":
            return `You asked to remove unavailable resources from ${name}.`;
        }
    }
  };
  const pendingMatches = (e: PendingMutationEntry): string => {
    switch (e.record.intent.op) {
      case "update":
        return "Its current details match what you asked for.";
      case "archive":
        return "It is archived now.";
      case "restore":
        return "It is active now.";
      case "setResources":
        return "Its current resources match what you asked for.";
    }
  };
  const pendingNow = (e: PendingMutationEntry): string => {
    if (e.checking) return "Checking its current state...";
    const ev = e.evaluation;
    switch (ev.finding) {
      case "consistentWithRequest":
        return `${pendingMatches(e)} That may be from your request or from another change.`;
      case "notInEffectNow":
        return "Your requested change isn't in effect now. If you still want it, make the change again from the unit.";
      case "changedSince":
        return "This unit has changed since your request, and its current state doesn't match it. Review the unit before making more changes.";
      case "unknown":
        switch (ev.basis) {
          case "notFound":
            return "LyfeLabz couldn't find this unit when it checked.";
          case "readUnavailable":
            return "LyfeLabz couldn't check its current state. Choose Check current state to try again.";
          case "inconsistent":
            return "LyfeLabz couldn't compare its current state with your request. Choose Check current state to try again.";
          default:
            return "Its current state hasn't been checked yet. Choose Check current state.";
        }
    }
  };
  const pendingText = (e: PendingMutationEntry): string =>
    e.status === "inFlight"
      ? sentences([askedFor(e.record), "LyfeLabz is still waiting for a response, so this unit can't be changed yet."])
      : sentences([askedFor(e.record), "This change wasn't confirmed.", pendingNow(e)]);
  // P2-5: asynchronous reconciliation updates are announced through the
  // region's own persistent polite status line (role="status",
  // aria-live="polite"), one message per change, never the whole list on
  // every render:
  // - on mount (including a remount), how many changes are listed;
  // - a restored request's outcome arriving, and every later change of an
  //   entry's present-state finding (an automatic or deliberate read, or a
  //   later confirmed change), as that entry's text;
  // - a request whose result arrived after the panel that sent it was
  //   replaced (a confirmed save, a no-op, or a definite refusal).
  // An entry's own first uncertain outcome is not repeated here: its card
  // shows it as an alert.
  // Each entry is tracked by the teacher-facing wording of its finding, so a
  // newer revision that reads the same is not news (F5).
  type Seen = { readonly text: string; readonly notChecked: boolean; readonly checked: boolean };
  let pendingSeen: Map<string, Seen> | null = null;
  const restoredIds = new Set<string>();
  let resolutionSeen = 0;
  // What the status line currently says is about: entry ids whose present
  // state it describes (cleared as soon as any of them is dismissed or
  // settled, so a dismissed finding is never left looking current, F4).
  let statusAbout: ReadonlySet<string> = new Set();
  const findingText = (e: PendingMutationEntry): string | null =>
    e.status !== "uncertain" || e.checking ? null : pendingText(e);
  const resolutionText = (r: PendingMutationResolution): string =>
    sentences([
      askedFor(r.record),
      r.outcome === "saved"
        ? "This change was saved."
        : r.outcome === "noop"
          ? "No change was needed when this request was checked."
          : "LyfeLabz couldn't make this change, so nothing was saved.",
    ]);
  const setPendingStatus = (text: string, about: ReadonlySet<string>): void => {
    statusAbout = about;
    // Never rewritten with the same words: no repeated announcement (F5).
    if ((pendingStatus.textContent ?? "") !== text) pendingStatus.textContent = text;
  };
  // What the region lists: every pending entry except this panel's own
  // requests that are still waiting for their response.
  const listedPending = (s: TeacherUnitsViewState): ReadonlyArray<PendingMutationEntry> =>
    s.pending.filter((e) => !(e.status === "inFlight" && s.ownInFlight.has(e.record.id)));
  const announcePendingUpdates = (s: TeacherUnitsViewState, listed: ReadonlyArray<PendingMutationEntry>): void => {
    const messages: string[] = [];
    const about = new Set<string>();
    const present = new Set(listed.map((e) => e.record.id));
    if (pendingSeen === null) {
      pendingSeen = new Map();
      for (const e of listed) {
        restoredIds.add(e.record.id);
        about.add(e.record.id);
        pendingSeen.set(e.record.id, {
          text: findingText(e) ?? "",
          notChecked: e.evaluation.basis === "notChecked",
          checked: e.checking,
        });
      }
      resolutionSeen = s.resolutions.reduce((m, r) => Math.max(m, r.seq), 0);
      const n = listed.filter((e) => e.status === "uncertain").length;
      if (n > 0) {
        messages.push(n === 1 ? "One change is listed under Unconfirmed changes." : `${n} changes are listed under Unconfirmed changes.`);
      }
      // A request an earlier panel sent that has no response yet is waiting,
      // not unconfirmed.
      const w = listed.length - n;
      if (w > 0) messages.push(w === 1 ? "One change is waiting for a response." : `${w} changes are waiting for a response.`);
    } else {
      for (const e of listed) {
        const id = e.record.id;
        const prev = pendingSeen.get(id);
        const text = findingText(e);
        const prevText = prev?.text ?? "";
        // The panel's own first outcome (and the automatic read that
        // completes it) is the card's alert; after that, every change is
        // news. Restored entries and deliberate checks are always news.
        const news = restoredIds.has(id) || prev?.checked === true || (prevText !== "" && prev?.notChecked !== true);
        if (text !== null && text !== prevText && news) {
          messages.push(text);
          about.add(id);
        }
        pendingSeen.set(id, {
          text: text ?? prevText,
          notChecked: text === null ? (prev?.notChecked ?? true) : e.evaluation.basis === "notChecked",
          checked: text === null ? (prev?.checked ?? false) || e.checking : false,
        });
      }
      for (const id of Array.from(pendingSeen.keys())) if (!present.has(id)) pendingSeen.delete(id);
      for (const r of s.resolutions) {
        if (r.seq <= resolutionSeen) continue;
        resolutionSeen = r.seq;
        messages.push(resolutionText(r));
      }
    }
    if (messages.length > 0) {
      setPendingStatus(messages.join(" "), about);
    } else if (Array.from(statusAbout).some((id) => !present.has(id))) {
      // Dismissed or settled: its present-state wording is withdrawn.
      // Dismissal confirms, cancels and undoes nothing, so nothing replaces it.
      setPendingStatus("", new Set());
    }
  };
  let pendingKey = "";
  const renderPending = (s: TeacherUnitsViewState): void => {
    const listed = listedPending(s);
    announcePendingUpdates(s, listed);
    // Shown while it lists anything or holds the latest update.
    pendingBox.hidden = listed.length === 0 && (pendingStatus.textContent ?? "") === "";
    const unconfirmed = listed.filter((e) => e.status === "uncertain");
    const waiting = listed.filter((e) => e.status === "inFlight");
    pendingBox.setAttribute(
      "aria-label",
      unconfirmed.length === 0 && waiting.length > 0 ? "Changes waiting for a response" : "Unconfirmed changes",
    );
    const key = JSON.stringify(listed.map((e) => [e.record.id, pendingText(e), e.status, e.checking]));
    if (key === pendingKey) return;
    pendingKey = key;
    const item = (e: PendingMutationEntry): HTMLElement => {
      const id = e.record.id;
      const li = el("li", "shell-units-recovery-item");
      li.setAttribute("data-testid", `units-pending-${id}`);
      li.setAttribute("data-unit-id", e.record.unitId);
      li.setAttribute("data-status", e.status);
      li.setAttribute("data-finding", e.status === "inFlight" ? "pending" : e.evaluation.finding);
      li.appendChild(el("p", "shell-units-recovery-message", pendingText(e)));
      if (e.status === "uncertain") {
        const actions = el("div", "shell-units-actions");
        const check = button("Check current state");
        check.setAttribute("data-testid", `units-pending-check-${id}`);
        setAriaDisabled(check, e.checking);
        check.addEventListener("click", () => {
          if (isInert(check)) return;
          void controller.checkPendingMutation(id);
        });
        const dismiss = button("Dismiss");
        dismiss.setAttribute("data-testid", `units-pending-dismiss-${id}`);
        dismiss.setAttribute("aria-label", `Dismiss unconfirmed change to "${e.record.titleAtRequest}"`);
        dismiss.addEventListener("click", () => {
          controller.dismissPendingMutation(id);
        });
        actions.appendChild(check);
        actions.appendChild(dismiss);
        li.appendChild(actions);
      }
      return li;
    };
    rebuildKeepingFocus(
      pendingBody,
      () => {
        // Only an uncertain outcome is introduced as unconfirmed.
        if (unconfirmed.length > 0) {
          const h = el("h4", "shell-units-subheading", "Unconfirmed changes");
          h.id = "units-pending-heading";
          pendingBody.appendChild(h);
          pendingBody.appendChild(
            el(
              "p",
              "shell-units-recovery-intro",
              "LyfeLabz couldn't confirm these changes. Each one shows what the unit looks like now, which can't tell you whether your request was saved. This list is kept while you stay on this page. Reloading the page clears it, but doesn't confirm or undo anything.",
            ),
          );
          const ul = el("ul", "shell-units-recovery-list");
          pendingBody.appendChild(ul);
          for (const e of unconfirmed) ul.appendChild(item(e));
        }
        // Requests an earlier panel sent that have no response yet.
        if (waiting.length > 0) {
          const h = el("h4", "shell-units-subheading", "Changes waiting for a response");
          h.id = "units-waiting-heading";
          pendingBody.appendChild(h);
          const ul = el("ul", "shell-units-recovery-list");
          ul.setAttribute("data-testid", "units-waiting-list");
          pendingBody.appendChild(ul);
          for (const e of waiting) ul.appendChild(item(e));
        }
      },
      (tid) =>
        tid !== null && tid.startsWith("units-pending-")
          ? pendingBox.querySelector<HTMLElement>("[data-testid^=units-pending-dismiss-]") ?? heading
          : null,
    );
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
    if (lastListKind === "loading" && s.list.kind === "ready") listReadsDone += 1;
    lastListKind = s.list.kind;
    if (checkRead !== null && s.list.kind === "loading" && s.list !== checkRead.started) checkRead.superseded = true;
    for (const [g, b] of gradeButtons) {
      const active = g === s.grade;
      b.setAttribute("aria-pressed", active ? "true" : "false");
      b.classList.toggle("shell-filter-pill-active", active);
    }
    archivedView.hidden = !s.showArchived;
    const archivedText = `Archived ${gradeLabel(s.grade)} units are shown with your active units. Restore a unit to use it again.`;
    if (archivedViewText.textContent !== archivedText) archivedViewText.textContent = archivedText;
    for (const b of readActions) setAriaDisabled(b, checking || s.list.kind === "loading");
    renderCreate(s);
    renderList(s);
    renderPending(s);
    refreshNotices();
    rescueFocus(before);
  };

  function startRead(trigger: HTMLButtonElement): void {
    if (disposed || isInert(trigger)) return;
    checking = true;
    const clearPending = announcePending("Loading your current units...");
    render();
    const done = controller.refresh();
    // `refresh` sets a new loading list synchronously when it dispatches; a
    // refused dispatch (account or school changed) leaves the list as it was.
    const started = controller.getState().list;
    const read = { started: started.kind === "loading" ? started : null, superseded: false };
    checkRead = read;
    void done.then(() => {
      if (disposed) return;
      if (checkRead === read) checkRead = null;
      checking = false;
      clearPending();
      // Announced only when this read produced the list now shown: not
      // superseded by a newer read (grade, archived view, Try again, another
      // check), not refused or ignored for a changed account or school, and
      // not failed (a failure shows in the list's own alert).
      const now = controller.getState().list;
      if (read.started !== null && !read.superseded && now.kind === "ready") {
        announce("Your units were refreshed.");
      }
      render();
    });
  }

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
      showReadAction(card.noticeRead, next, null);
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
    showReadAction(statusRead, status.textContent ?? "", heading);
    for (const e of entries.values()) {
      const next = entryText(e);
      if (e.message.textContent !== next) e.message.textContent = next;
      showReadAction(e.read, next, e.dismiss);
      const label = `Dismiss notice about ${controller.getKnownUnit(e.unitId)?.title ?? e.fallbackTitle}`;
      if (e.dismiss.getAttribute("aria-label") !== label) e.dismiss.setAttribute("aria-label", label);
    }
  };

  // Milestone 1 automatic freshness: returning to this browser tab reads
  // the list again through the same `refresh` as Load current units (same
  // ordering, revision, and account guards; nothing is resent). Silent, at
  // most once per AUTO_REFRESH_MIN_MS, and only while a loaded list is shown
  // and no other read is running. No polling.
  const AUTO_REFRESH_MIN_MS = 30_000;
  let lastAutoRefresh = Date.now();
  const onVisibility = (): void => {
    if (disposed || doc.visibilityState !== "visible") return;
    if (!root.isConnected) {
      if (wasConnected) dispose();
      return;
    }
    const now = Date.now();
    if (now - lastAutoRefresh < AUTO_REFRESH_MIN_MS) return;
    if (checking || controller.getState().list.kind !== "ready") return;
    lastAutoRefresh = now;
    void controller.refresh();
  };
  doc.addEventListener("visibilitychange", onVisibility);

  const unsubscribe = controller.subscribe(render);
  // A confirmed assignment change re-applies every lesson row's Assign /
  // Results control in place (focus and card state are kept).
  const lessonActions = options.lessonActions ?? null;
  const unsubscribeLessons =
    lessonActions === null
      ? () => undefined
      : lessonActions.subscribe(() => {
          for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-lesson-slug]"))) {
            const slug = b.getAttribute("data-lesson-slug");
            if (slug !== null) lessonActions.apply(b, slug);
          }
        });
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener("visibilitychange", onVisibility);
    unsubscribe();
    unsubscribeLessons();
    controller.dispose();
  };
  render();
  return Object.freeze({ dispose });
}

// ---------- Milestone 2A: Add to Unit from Curriculum ----------
//
// The dialog Curriculum opens for its resource selection
// (TEACHER_UNITS.md "Milestone 2A"). It is a second client of the same units
// controller My Units uses: the controller is created when the dialog opens
// (one authoritative list read) and disposed when it closes. Membership is
// one `addResources` request (the held list plus the ids it lacks, with the
// held `expectedRevision`); a new unit is the durable `submitCreate`
// followed, once the create is confirmed, by that same request. Nothing is
// resent automatically and nothing is shown as added until the server
// confirms it. Selection state is Curriculum's; the dialog only reports a
// confirmed outcome through `onAdded`.

export type AddToUnitOutcome = {
  readonly unitId: string;
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  // Resources this request added, and selected resources the unit already
  // held. Both come from the confirmed request, never from a later read.
  readonly added: number;
  readonly alreadyPresent: number;
  readonly created: boolean;
};

export type AddToUnitDialogInput = {
  readonly seam: TeacherUnitsSurfaceSeam;
  readonly uid: string;
  readonly schoolId: string;
  // Milestone 2B: the Curriculum visit's own controller, so a confirmed
  // addition updates its unit-name pills at once. The dialog then never
  // disposes it. Without one, the dialog creates and disposes its own.
  readonly controller?: TeacherUnitsController | null;
  // Canonical RA-1 ids, in the order the unit should receive them.
  readonly resourceIds: ReadonlyArray<string>;
  readonly initialGrade: TeacherUnitGrade;
  // Where focus returns when the dialog closes without a confirmed addition.
  readonly returnFocus: HTMLElement | null;
  readonly onAdded: (outcome: AddToUnitOutcome) => void;
  // Opens My Units (on a unit when one is named). Null when unavailable.
  readonly openMyUnits: ((target: { readonly unitId: string; readonly grade: TeacherUnitGrade } | null) => void) | null;
};

const ADD_CREATE_BLOCKED: Partial<Record<CreateBlockedReason, string>> = Object.freeze({
  recoveryPending:
    "You have a unit request that LyfeLabz couldn't confirm. Open My Units to check it before creating another unit.",
  checkRequired: "Open My Units and choose Check my units before creating another unit.",
  storageUnavailable:
    "LyfeLabz couldn't save this request in your browser, so it wasn't sent. Check that this browser allows site data, then try again.",
  noSession: "Your sign-in changed. Reload the page and sign in to continue.",
});

export function openAddToUnitDialog(doc: Document, input: AddToUnitDialogInput): { readonly close: () => void } {
  requireTeacherUnitsAvailable();
  const ids = input.resourceIds;
  const shared = input.controller ?? null;
  const controller =
    shared ??
    input.seam.createController({
      uid: input.uid,
      schoolId: input.schoolId,
      initialGrade: input.initialGrade,
    });
  // A shared controller already holds a list; read the chosen grade afresh.
  if (shared !== null) {
    if (shared.getState().grade !== input.initialGrade) shared.setGrade(input.initialGrade);
    else void shared.refresh();
  }

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
  const tid = (e: HTMLElement, id: string): void => e.setAttribute("data-testid", id);

  const overlay = el("div", "shell-assign-overlay shell-units-add-overlay");
  tid(overlay, "units-add-overlay");
  const dialog = el("div", "shell-assign-dialog shell-units-add-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "units-add-title");
  tid(dialog, "units-add-dialog");
  overlay.appendChild(dialog);

  // The heading stands alone: the selection itself is the Curriculum's
  // selection bar, so the dialog repeats no resource count.
  const head = el("div", "shell-units-add-head");
  const title = el("h3", "shell-assign-title", "Add to a unit");
  title.id = "units-add-title";
  title.tabIndex = -1;
  head.appendChild(title);
  dialog.appendChild(head);

  const body = el("div", "shell-assign-body");
  dialog.appendChild(body);

  const gradeRow = el("div", "shell-filter-row shell-units-add-grades");
  gradeRow.setAttribute("role", "group");
  gradeRow.setAttribute("aria-label", "Unit grade");
  const gradeButtons = new Map<TeacherUnitGrade, HTMLButtonElement>();
  for (const g of TEACHER_UNIT_GRADES) {
    const b = el("button", "shell-filter-pill", gradeLabel(g));
    b.type = "button";
    tid(b, `units-add-grade-${g}`);
    b.addEventListener("click", () => {
      if (pending || controller.getState().grade === g) return;
      chosen = null;
      clearProblem();
      controller.setGrade(g);
    });
    gradeButtons.set(g, b);
    gradeRow.appendChild(b);
  }
  body.appendChild(gradeRow);

  const gradeNote = el("p", "shell-units-add-note");
  tid(gradeNote, "units-add-grade-note");
  gradeNote.hidden = true;
  body.appendChild(gradeNote);

  const fieldset = el("fieldset", "shell-units-add-choices");
  const legend = el("legend", undefined, "Select a unit");
  fieldset.appendChild(legend);
  const listState = el("p", "shell-units-add-list-state");
  tid(listState, "units-add-list-state");
  fieldset.appendChild(listState);
  const retry = el("button", "shell-assign-cancel shell-units-add-retry", "Try again");
  retry.type = "button";
  tid(retry, "units-add-retry");
  retry.hidden = true;
  retry.addEventListener("click", () => void controller.refresh());
  fieldset.appendChild(retry);
  const choices = el("div", "shell-units-add-options");
  fieldset.appendChild(choices);

  const radioName = "units-add-choice";
  const newRow = el("label", "shell-units-add-option");
  const newRadio = el("input");
  newRadio.type = "radio";
  newRadio.name = radioName;
  newRadio.value = "new";
  tid(newRadio, "units-add-choice-new");
  newRow.appendChild(newRadio);
  newRow.appendChild(el("span", "shell-units-add-option-title", "Create a new unit"));
  fieldset.appendChild(newRow);
  const newField = el("div", "shell-units-add-new");
  const newLabel = el("label", undefined, "New unit name");
  newLabel.htmlFor = "units-add-new-title";
  const newTitle = el("input");
  newTitle.type = "text";
  newTitle.id = "units-add-new-title";
  newTitle.maxLength = TEACHER_UNIT_TITLE_MAX_LENGTH;
  newTitle.autocomplete = "off";
  tid(newTitle, "units-add-new-title");
  newField.append(newLabel, newTitle);
  newField.hidden = true;
  fieldset.appendChild(newField);
  body.appendChild(fieldset);

  const problem = el("p", "shell-units-add-problem");
  problem.id = "units-add-problem";
  problem.setAttribute("role", "alert");
  tid(problem, "units-add-problem");
  problem.hidden = true;
  body.appendChild(problem);
  const openUnits = el("button", "shell-assign-cancel shell-units-add-open-units", "Open My Units");
  openUnits.type = "button";
  tid(openUnits, "units-add-open-units");
  openUnits.hidden = true;
  body.appendChild(openUnits);
  const status = el("p", "shell-units-add-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  tid(status, "units-add-status");
  body.appendChild(status);

  const footer = el("div", "shell-assign-footer");
  const cancel = el("button", "shell-assign-cancel", "Cancel");
  cancel.type = "button";
  tid(cancel, "units-add-cancel");
  const confirm = el("button", "shell-assign-confirm", "Add to Unit");
  confirm.type = "button";
  tid(confirm, "units-add-confirm");
  footer.append(cancel, confirm);
  dialog.appendChild(footer);

  // `chosen`: a unit id, "new", or nothing yet. The unit whose ids are named
  // in a pending request is fixed until it settles.
  let chosen: string | null = null;
  let pending = false;
  let closed = false;
  let openUnitsTarget: { readonly unitId: string; readonly grade: TeacherUnitGrade } | null = null;
  let renderedList: TeacherUnitsViewState["list"] | null = null;
  let hasUnits = true;

  const clearProblem = (): void => {
    problem.hidden = true;
    problem.textContent = "";
    openUnits.hidden = true;
    newTitle.removeAttribute("aria-invalid");
    newTitle.removeAttribute("aria-describedby");
  };
  const showProblem = (
    text: string,
    options: { readonly myUnits?: boolean; readonly target?: { readonly unitId: string; readonly grade: TeacherUnitGrade } | null } = {},
  ): void => {
    problem.textContent = text;
    problem.hidden = false;
    openUnits.hidden = !(options.myUnits === true && input.openMyUnits !== null);
    openUnitsTarget = options.target ?? null;
  };
  const setPending = (message: string | null): void => {
    pending = message !== null;
    status.textContent = message ?? "";
    confirm.setAttribute("aria-disabled", pending ? "true" : "false");
    confirm.setAttribute("aria-busy", pending ? "true" : "false");
    newTitle.readOnly = pending;
    for (const r of Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type=radio]"))) {
      r.setAttribute("aria-disabled", pending ? "true" : "false");
    }
    for (const b of gradeButtons.values()) b.setAttribute("aria-disabled", pending ? "true" : "false");
  };

  // Only the duplicate note is shown beside a unit name; its size is not.
  const unitMeta = (u: TeacherUnit): string => {
    const present = ids.filter((id) => u.resourceIds.includes(id)).length;
    if (present === 0) return "";
    if (present === ids.length) return `Already has ${ids.length === 1 ? "this resource" : "all of these"}`;
    return `Already has ${present} of these`;
  };

  const renderChoices = (s: TeacherUnitsViewState): void => {
    const list = s.list;
    if (list === renderedList) {
      // Same records: refresh labels in place (a confirmed write replaces the
      // list object, so this only covers busy-state renders).
      return;
    }
    renderedList = list;
    const hadFocus = choices.contains(doc.activeElement);
    choices.textContent = "";
    retry.hidden = list.kind !== "error";
    if (list.kind === "loading") {
      listState.textContent = `Loading your ${gradeLabel(s.grade)} units...`;
      listState.hidden = false;
      return;
    }
    if (list.kind === "error") {
      listState.textContent = `Your ${gradeLabel(s.grade)} units couldn't be loaded.`;
      listState.hidden = false;
      return;
    }
    const units = list.units.filter((u) => u.status === "active");
    // Milestone 2B: with no units, creating one is the only next step, so
    // the fieldset is just the new unit's name (no empty-state sentence and
    // no lone radio button).
    listState.hidden = true;
    listState.textContent = "";
    hasUnits = units.length > 0;
    if (chosen !== null && chosen !== "new" && !units.some((u) => u.unitId === chosen)) chosen = null;
    if (units.length === 0) chosen = "new";
    for (const u of units) {
      const row = el("label", "shell-units-add-option");
      const radio = el("input");
      radio.type = "radio";
      radio.name = radioName;
      radio.value = u.unitId;
      tid(radio, `units-add-choice-${u.unitId}`);
      radio.checked = chosen === u.unitId;
      radio.setAttribute("aria-disabled", pending ? "true" : "false");
      row.appendChild(radio);
      row.appendChild(el("span", "shell-units-add-option-title", u.title));
      const metaText = unitMeta(u);
      if (metaText !== "") {
        const meta = el("span", "shell-units-add-option-meta", metaText);
        tid(meta, `units-add-choice-meta-${u.unitId}`);
        row.appendChild(meta);
      }
      choices.appendChild(row);
    }
    if (hadFocus) {
      const target =
        choices.querySelector<HTMLInputElement>("input:checked") ?? choices.querySelector<HTMLInputElement>("input");
      (target ?? newRadio).focus();
    }
  };

  const render = (): void => {
    if (closed) return;
    const s = controller.getState();
    for (const [g, b] of gradeButtons) {
      const active = g === s.grade;
      b.setAttribute("aria-pressed", active ? "true" : "false");
      b.classList.toggle("shell-filter-pill-active", active);
    }
    const otherGrade = ids.filter((id) => {
      const g = getPlaceableResources().find((r) => r.id === id)?.grade ?? null;
      return g !== null && g !== s.grade;
    }).length;
    gradeNote.hidden = otherGrade === 0;
    gradeNote.textContent =
      otherGrade === 0
        ? ""
        : `${otherGrade === ids.length ? (ids.length === 1 ? "This resource is" : "These resources are") : `${otherGrade} of these resources are`} from another grade. A unit can hold resources from any grade.`;
    renderChoices(s);
    newRadio.checked = chosen === "new";
    newField.hidden = chosen !== "new";
    const emptyGrade = s.list.kind === "ready" && !hasUnits;
    newRow.hidden = emptyGrade;
    const legendText = emptyGrade ? `New ${gradeLabel(s.grade)} unit` : "Select a unit";
    if (legend.textContent !== legendText) legend.textContent = legendText;
    const confirmText = chosen === "new" ? "Create Unit & Add" : "Add to Unit";
    if (confirm.textContent !== confirmText) confirm.textContent = confirmText;
  };

  fieldset.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "radio") return;
    if (pending) {
      // Keep the choice a pending request was sent for.
      for (const r of Array.from(fieldset.querySelectorAll<HTMLInputElement>("input[type=radio]"))) {
        r.checked = r.value === chosen;
      }
      return;
    }
    chosen = t.value;
    clearProblem();
    render();
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    doc.removeEventListener("keydown", onKey);
    unregisterModal();
    unsubscribe();
    if (shared === null) controller.dispose();
  };
  const dismiss = (): void => {
    close();
    try {
      input.returnFocus?.focus();
    } catch {
      // ignored
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      dismiss();
    }
  };

  // Reports a settled membership request. Returns true when the dialog closed.
  const settle = (unitId: string, result: UnitMutationResult, created: TeacherUnit | null): boolean => {
    const unit = created ?? controller.getKnownUnit(unitId);
    const name = unit !== null ? `"${unit.title}"` : "this unit";
    const grade = unit?.grade ?? controller.getState().grade;
    const createdPrefix = created !== null ? `Created ${name}, but ` : "";
    const lead = (rest: string): string =>
      createdPrefix === "" ? rest.charAt(0).toUpperCase() + rest.slice(1) : `${createdPrefix}${rest}`;
    switch (result.kind) {
      case "saved": {
        const added = result.committed
          ? result.committed.resourceIds.length - result.committed.previous.length
          : 0;
        close();
        input.onAdded(
          Object.freeze({
            unitId,
            grade,
            title: result.unit.title,
            added,
            alreadyPresent: ids.length - added,
            created: created !== null,
          }),
        );
        return true;
      }
      case "conflict":
        showProblem(
          lead(
            "this unit changed since it was loaded here, so LyfeLabz couldn't confirm whether anything was added. Check the unit below, then choose Add to Unit again.",
          ),
        );
        return false;
      case "archived":
        showProblem(lead("this unit was archived, so nothing was added. Restore it in My Units to add resources."), {
          myUnits: true,
          target: null,
        });
        return false;
      case "uncertain": {
        const latest = result.latest;
        const now =
          latest === null
            ? "Its latest version couldn't be loaded."
            : ids.every((id) => latest.resourceIds.includes(id))
              ? `${ids.length === 1 ? "This resource is" : "All of these resources are"} in ${name} now. You can clear your selection.`
              : `${name.charAt(0).toUpperCase()}${name.slice(1)} doesn't have all of these resources now.`;
        showProblem(`${lead("LyfeLabz couldn't confirm whether the resources were added.")} ${now}`, {
          myUnits: true,
          target: { unitId, grade },
        });
        return false;
      }
      case "busy":
        showProblem(lead("another change to this unit is still being saved. Try again in a moment."));
        return false;
      case "needsCheck":
      case "capacity":
        showProblem(
          lead("an earlier change to this unit hasn't been confirmed yet. Open My Units to load its current state, then try again."),
          { myUnits: true, target: { unitId, grade } },
        );
        return false;
      case "error":
        showProblem(createdPrefix === "" ? result.error.message : `${createdPrefix}${result.error.message}`);
        return false;
      case "invalid":
        showProblem(result.message);
        return false;
      case "stale":
        close();
        return true;
    }
  };

  const submit = async (): Promise<void> => {
    if (pending || closed) return;
    clearProblem();
    if (chosen === null) {
      showProblem("Select a unit, or create a new one.");
      (choices.querySelector<HTMLInputElement>("input") ?? newRadio).focus();
      return;
    }
    if (chosen !== "new") {
      const unitId = chosen;
      setPending("Adding resources...");
      const result = await controller.addResources(unitId, ids);
      if (closed) return;
      setPending(null);
      if (!settle(unitId, result, null)) render();
      return;
    }
    const titleError = validateUnitTitle(newTitle.value);
    if (titleError !== null) {
      showProblem(titleError);
      newTitle.setAttribute("aria-invalid", "true");
      newTitle.setAttribute("aria-describedby", problem.id);
      newTitle.focus();
      return;
    }
    const grade = controller.getState().grade;
    const name = newTitle.value.trim();
    const before = controller.getState().create.kind;
    if (before === "created" || before === "rejected" || before === "abandoned") controller.beginNewUnit();
    setPending("Creating your unit...");
    await controller.submitCreate({ grade, title: name, description: "" });
    if (closed) return;
    const s = controller.getState();
    if (s.createBlocked !== null) {
      setPending(null);
      showProblem(ADD_CREATE_BLOCKED[s.createBlocked] ?? "LyfeLabz couldn't create this unit, so nothing was saved. Try again.", {
        myUnits: s.createBlocked === "recoveryPending" || s.createBlocked === "checkRequired",
        target: null,
      });
      return;
    }
    const create = s.create;
    if (create.kind === "rejected") {
      setPending(null);
      showProblem(
        create.error.category === "invalidField"
          ? create.error.message
          : "LyfeLabz couldn't create this unit, so nothing was saved. Check the unit name, then try again.",
      );
      return;
    }
    if (create.kind !== "created") {
      setPending(null);
      showProblem(
        `LyfeLabz couldn't confirm whether "${name}" was created, so nothing was added. Open My Units to check it. Your selection is kept.`,
        { myUnits: true, target: null },
      );
      return;
    }
    const unit = create.unit;
    chosen = unit.unitId;
    newTitle.value = "";
    setPending("Adding resources...");
    const result = await controller.addResources(unit.unitId, ids);
    if (closed) return;
    setPending(null);
    if (!settle(unit.unitId, result, unit)) render();
  };

  // Activation of an aria-disabled control is ignored (it keeps focus).
  confirm.addEventListener("click", () => void submit());
  newTitle.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submit();
    }
  });
  cancel.addEventListener("click", dismiss);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) dismiss();
  });
  openUnits.addEventListener("click", () => {
    const target = openUnitsTarget;
    close();
    input.openMyUnits?.(target);
  });
  doc.addEventListener("keydown", onKey);
  const unregisterModal = registerOpenModal(close);
  const unsubscribe = controller.subscribe(render);

  doc.body.appendChild(overlay);
  render();
  try {
    title.focus({ preventScroll: true });
  } catch {
    // ignored
  }
  return Object.freeze({ close });
}
